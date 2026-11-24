"""Command line entry point: `crimemap load ...`."""

from __future__ import annotations

import argparse
import os
import sys
import time as time_module
from collections.abc import Callable
from datetime import date, datetime, time, timedelta
from pathlib import Path

from . import changes as changelog
from .arcgis import DEFAULT_LAYER_URL, ArcGISError, Layer, range_where, utc_literal
from .historical import load_historical
from .records import ATLANTA, SANE_EARLIEST, normalize
from .site import build_site
from .store import Archive, write_source_snapshot

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATA_DIR = REPO_ROOT / "data"
DATASET = "nibrs"

# Refuse to commit a refresh that loses this much of what is already archived;
# it far more likely means the source is broken than that crime fell.
SHRINK_LIMIT = 0.9

# APD republishes the whole layer roughly hourly, and for a minute or so it is
# empty or partly loaded. A fetch only counts if every response came from the
# same publication and the record count is unchanged after a pause; otherwise
# the fetch is repeated.
FETCH_ATTEMPTS = 6
RETRY_WAIT_SECONDS = 120
EXIT_SHRINK = 3
EXIT_UNSTABLE = 4


def local_midnight(d: date) -> datetime:
    return datetime.combine(d, time(0), tzinfo=ATLANTA)


def parse_date(text: str) -> date:
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"expected YYYY-MM-DD, got {text!r}") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="crimemap")
    sub = parser.add_subparsers(dest="command", required=True)
    load = sub.add_parser("load", help="refresh the archive from the APD open data layer")
    load.add_argument("--start", type=parse_date, help="first report date (Atlanta time)")
    load.add_argument("--end", type=parse_date, help="last report date, inclusive (default today)")
    load.add_argument(
        "--days",
        type=int,
        default=90,
        help="without --start, refresh this many days back (default 90)",
    )
    load.add_argument(
        "--all", action="store_true", help="re-fetch the entire layer and replace the archive"
    )
    load.add_argument(
        "--force",
        action="store_true",
        help="write even if the refresh would drop many archived records",
    )
    load.add_argument(
        "--data-dir", type=Path, default=Path(os.environ.get("CRIMEMAP_DATA_DIR", DEFAULT_DATA_DIR))
    )
    load.add_argument("--layer-url", default=DEFAULT_LAYER_URL)
    load.add_argument(
        "--settle-seconds",
        type=int,
        default=90,
        help="pause before re-checking that the source did not change mid-fetch (default 90)",
    )
    load.add_argument(
        "--summary-file",
        type=Path,
        help="write a one-line description of the change (for commit messages)",
    )
    site = sub.add_parser("build-site", help="derive the web map's data files from the archive")
    site.add_argument(
        "--data-dir", type=Path, default=Path(os.environ.get("CRIMEMAP_DATA_DIR", DEFAULT_DATA_DIR))
    )
    site.add_argument(
        "--out",
        type=Path,
        default=REPO_ROOT / "frontend" / "public" / "data",
        help="output directory (default frontend/public/data)",
    )
    historical = sub.add_parser(
        "load-historical",
        help="fetch APD's 1997-2020 layers into data/historical/ (one-off)",
    )
    historical.add_argument(
        "--data-dir", type=Path, default=Path(os.environ.get("CRIMEMAP_DATA_DIR", DEFAULT_DATA_DIR))
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "build-site":
        manifest = build_site(args.data_dir, args.out)
        size = sum(p.stat().st_size for p in args.out.rglob("*") if p.is_file())
        print(
            f"Built site data for {manifest['count']} incidents through {manifest['through']} "
            f"({size / 1e6:.1f} MB in {args.out})"
        )
        return 0
    if args.command == "load-historical":
        counts = load_historical(args.data_dir)
        print(
            f"Loaded {counts['rows']} historical records into {counts['months']} files "
            f"({counts['duplicates']} duplicates dropped, {counts['unmapped']} without an offense)"
        )
        return 0
    return load(args)


def load(
    args: argparse.Namespace,
    layer: Layer | None = None,
    now: datetime | None = None,
    sleep: Callable[[float], None] = time_module.sleep,
) -> int:
    now = now or datetime.now(ATLANTA)
    layer = layer or Layer(args.layer_url)
    dataset_dir = args.data_dir / DATASET
    archive = Archive.load(dataset_dir)

    if args.all:
        if args.start or args.end:
            print("--all cannot be combined with --start/--end", file=sys.stderr)
            return 2
        start, end = SANE_EARLIEST, now + timedelta(days=2)
        label = "all records"
        unusual = (
            f"ReportDate IS NULL OR ReportDate < {utc_literal(start)} "
            f"OR ReportDate >= {utc_literal(end)}"
        )
        count_where = "1=1"
        before = len(archive.all_rows())
    else:
        end_day = args.end or now.date()
        start_day = args.start or (end_day - timedelta(days=args.days - 1))
        if start_day > end_day:
            print("--start is after --end", file=sys.stderr)
            return 2
        start, end = local_midnight(start_day), local_midnight(end_day + timedelta(days=1))
        label = f"{start_day} .. {end_day}"
        unusual = None
        count_where = range_where(start, end)
        before = archive.rows_in_window(start, end)

    def fetch() -> list[dict]:
        raw = layer.query_range(start, end)
        if unusual:
            raw += layer.query_all(unusual)
        return raw

    print(f"Fetching {label} from {layer.url}", file=sys.stderr)
    raw: list[dict] = []
    failure = EXIT_UNSTABLE
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        problem = None
        layer.versions.clear()
        try:
            raw = fetch()
            sleep(args.settle_seconds)
            recount = layer.count(count_where)
        except ArcGISError as exc:
            problem, failure = str(exc), EXIT_UNSTABLE
        else:
            if len(layer.versions) > 1:
                problem = "the layer was republished during the fetch"
                failure = EXIT_UNSTABLE
            elif recount != len(raw):
                problem = f"fetched {len(raw)} records but the source now reports {recount}"
                failure = EXIT_UNSTABLE
            elif before >= 200 and len(raw) < before * SHRINK_LIMIT and not args.force:
                problem = (
                    f"the source has {len(raw)} records where the archive has {before}; "
                    "it looks incomplete"
                )
                failure = EXIT_SHRINK
        if problem is None:
            break
        print(f"Attempt {attempt}/{FETCH_ATTEMPTS}: {problem}", file=sys.stderr)
        if attempt == FETCH_ATTEMPTS:
            if failure == EXIT_SHRINK:
                print(
                    f"Refusing to replace {before} archived records with {len(raw)}. "
                    "Re-run with --force if this drop is real.",
                    file=sys.stderr,
                )
            else:
                print("The source never settled; nothing was written.", file=sys.stderr)
            return failure
        sleep(RETRY_WAIT_SECONDS)

    field_types = layer.field_types
    fresh = [normalize(attrs, field_types) for attrs in raw]
    print(f"Fetched {len(fresh)} records (archive had {before} in that range)", file=sys.stderr)

    source_columns = [f["name"] for f in layer.fields if f["name"] != layer.oid_field]
    old_columns = list(archive.columns)
    archive.set_columns(source_columns)
    if args.all:
        replaced = archive.replace_all(fresh, now)
    else:
        replaced = archive.replace_window(fresh, start, end, now)
    # Before the archive is rewritten, keep every row APD removed or edited.
    # The log is written first: after a crash a re-run may log a row twice,
    # which is recoverable, but it can never lose one.
    shared_columns = [c for c in old_columns if c in source_columns]
    entries = changelog.diff_rows(replaced, fresh, shared_columns)
    logged = changelog.append_changes(args.data_dir / changelog.DATASET, entries, old_columns, now)
    changes = archive.save()
    write_source_snapshot(dataset_dir, layer.url, layer.fields)

    added = sum(a for a, _ in changes.values())
    removed = sum(r for _, r in changes.values())
    summary = (
        f"Refresh NIBRS incidents, {label}: {len(changes)} files changed, +{added} -{removed} rows"
    )
    kinds: dict[str, int] = {}
    for kind, _, _ in entries:
        kinds[kind] = kinds.get(kind, 0) + 1
    if logged:
        summary += f"; {logged} prior versions logged"
    print(summary)
    for kind, n in sorted(kinds.items()):
        print(f"  logged {kind}: {n}")
    for part, (a, r) in sorted(changes.items()):
        print(f"  {part}: +{a} -{r}")
    if args.summary_file:
        args.summary_file.write_text(summary + "\n", encoding="utf-8")
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(f"### {summary}\n\n| File | Added | Removed |\n|---|---|---|\n")
            for part, (a, r) in sorted(changes.items()):
                fh.write(f"| {part} | {a} | {r} |\n")
            if kinds:
                fh.write("\n| Logged to nibrs-changes | Rows |\n|---|---|\n")
                for kind, n in sorted(kinds.items()):
                    fh.write(f"| {kind} | {n} |\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
