"""Command line entry point: `crimemap load ...`."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path

from .arcgis import DEFAULT_LAYER_URL, Layer, utc_literal
from .records import ATLANTA, SANE_EARLIEST, normalize
from .store import Archive, write_source_snapshot

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DATA_DIR = REPO_ROOT / "data"
DATASET = "nibrs"

# Refuse to commit a refresh that loses this much of what is already archived;
# it far more likely means the source is broken than that crime fell.
SHRINK_LIMIT_WINDOW = 0.5
SHRINK_LIMIT_ALL = 0.9


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
        "--summary-file",
        type=Path,
        help="write a one-line description of the change (for commit messages)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return load(args)


def load(args: argparse.Namespace, layer: Layer | None = None, now: datetime | None = None) -> int:
    now = now or datetime.now(ATLANTA)
    layer = layer or Layer(args.layer_url)
    dataset_dir = args.data_dir / DATASET
    archive = Archive.load(dataset_dir)
    field_types = layer.field_types

    if args.all:
        if args.start or args.end:
            print("--all cannot be combined with --start/--end", file=sys.stderr)
            return 2
        start, end = SANE_EARLIEST, now + timedelta(days=2)
        label = "all records"
        print(f"Fetching the full layer from {layer.url}", file=sys.stderr)
        raw = layer.query_range(start, end)
        unusual = (
            f"ReportDate IS NULL OR ReportDate < {utc_literal(start)} "
            f"OR ReportDate >= {utc_literal(end)}"
        )
        raw += layer.query_all(unusual)
        before = len(archive.all_rows())
        limit = SHRINK_LIMIT_ALL
    else:
        end_day = args.end or now.date()
        start_day = args.start or (end_day - timedelta(days=args.days - 1))
        if start_day > end_day:
            print("--start is after --end", file=sys.stderr)
            return 2
        start, end = local_midnight(start_day), local_midnight(end_day + timedelta(days=1))
        label = f"{start_day} .. {end_day}"
        print(f"Fetching report dates {label} from {layer.url}", file=sys.stderr)
        raw = layer.query_range(start, end)
        before = archive.rows_in_window(start, end)
        limit = SHRINK_LIMIT_WINDOW

    fresh = [normalize(attrs, field_types) for attrs in raw]
    print(f"Fetched {len(fresh)} records (archive had {before} in that range)", file=sys.stderr)
    if before >= 200 and len(fresh) < before * limit and not args.force:
        print(
            f"Refusing to replace {before} archived records with {len(fresh)}: the source looks "
            "incomplete. Re-run with --force if this drop is real.",
            file=sys.stderr,
        )
        return 3

    source_columns = [f["name"] for f in layer.fields if f["name"] != layer.oid_field]
    archive.set_columns(source_columns)
    if args.all:
        archive.replace_all(fresh, now)
    else:
        archive.replace_window(fresh, start, end, now)
    changes = archive.save()
    write_source_snapshot(dataset_dir, layer.url, layer.fields)

    added = sum(a for a, _ in changes.values())
    removed = sum(r for _, r in changes.values())
    summary = (
        f"Refresh NIBRS incidents, {label}: {len(changes)} files changed, +{added} -{removed} rows"
    )
    print(summary)
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
