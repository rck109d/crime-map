"""Build the static data files the web map loads (`crimemap build-site`).

GitHub Pages can only serve files, so everything the browser needs is derived
here from the CSV archive:

    manifest.json        dictionaries, per-month row counts, coverage dates
    points-YYYY.bin      one compact, gzip-compressed table per year
    detail/YYYY-MM.json  per-month text fields, fetched when an incident is opened
    search.json          streets, addresses and intersections, for the map's search

Row N of a month is the same incident in the points table and the detail file.
Nothing written here is committed; it is rebuilt from data/ on every deploy.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import struct
import sys
from array import array
from collections import Counter
from datetime import date, datetime
from pathlib import Path

from .hull import outlines
from .search_index import build_search_index, clean_address, number_addresses
from .store import read_csv

FORMAT_VERSION = 2
MAGIC = b"CMAP"

# The source's coverage starts in 2021; the few earlier report dates in the
# archive are stray records, not history, and would only stretch the timeline.
SITE_FIRST_YEAR = 2021
EPOCH = date(SITE_FIRST_YEAR, 1, 1)

# Coordinates are stored as 16-bit steps across this box (about 0.85 m each).
# It comfortably contains the city and the airport; anything outside it is a
# geocoding error in the source and is published without a map position.
BBOX = {"west": -84.75, "south": 33.50, "east": -84.15, "north": 34.00}
COORD_STEPS = 65534
NO_COORD = 0xFFFF

# Colour groups on the map: NIBRS's own top-level classification.
GROUPS = ["Person", "Property", "Society"]
UNCLASSIFIED_GROUP = len(GROUPS)
UNCLASSIFIED_NAME = "Unclassified"

FLAG_FIREARM = 1
FLAG_FAMILY_VIOLENCE = 2
# UCR "Part I" (the FBI's traditional index crimes). It follows from the offense,
# but is stored per row so the browser can filter on it like any other flag.
FLAG_PART_ONE = 4
# Set on a row that belongs to the same report as the row before it: same
# incident number and report time. APD publishes one row per offense, and the
# archive's sort order keeps the rows of one report together, so a run of rows
# joined by this flag is one incident with all its offenses.
FLAG_SAME_INCIDENT = 8
UNKNOWN_U8 = 255


class Dictionary:
    """Assigns small integer ids to strings in first-seen order."""

    def __init__(self, first: str | None = None):
        self.ids: dict[str, int] = {}
        if first is not None:
            self.ids[first] = 0

    def id(self, value: str) -> int:
        try:
            return self.ids[value]
        except KeyError:
            self.ids[value] = len(self.ids)
            return self.ids[value]

    @property
    def values(self) -> list[str]:
        return list(self.ids)


def quantize(value: str, low: float, high: float) -> int | None:
    try:
        number = float(value)
    except ValueError:
        return None
    if not (low <= number <= high):
        return None
    return round((number - low) / (high - low) * COORD_STEPS)


def local_parts(iso: str) -> datetime | None:
    """Wall-clock time in Atlanta, as archived (the UTC offset is dropped)."""
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso).replace(tzinfo=None)
    except ValueError:
        return None


def title_case_code(value: str) -> str:
    """GROCERY_SUPERMARKET -> Grocery supermarket."""
    return value.replace("_", " ").strip().capitalize()


def encode_points(columns16: list[array], columns8: list[array], count: int) -> bytes:
    body = bytearray(MAGIC + struct.pack("<HHI", FORMAT_VERSION, 0, count))
    for col in columns16:
        if sys.byteorder != "little":
            col = array("H", col)
            col.byteswap()
        body += col.tobytes()
    for col in columns8:
        body += col.tobytes()
    return gzip.compress(bytes(body), compresslevel=9, mtime=0)


def build_site(data_dir: Path, out_dir: Path) -> dict:
    dataset = data_dir / "nibrs"
    month_files = sorted(
        p
        for p in dataset.glob("[0-9][0-9][0-9][0-9]/*.csv")
        if int(p.parent.name) >= SITE_FIRST_YEAR
    )
    if not month_files:
        raise SystemExit(f"no archived months found under {dataset}")

    offenses = Dictionary()
    offense_info: list[dict] = []
    nhoods = Dictionary("")
    npus = Dictionary("")
    zones = Dictionary("")
    location_types = Dictionary("")

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "detail").mkdir(exist_ok=True)
    for stale in [*out_dir.glob("points-*.bin"), *(out_dir / "detail").glob("*.json")]:
        stale.unlink()

    # Every row carries the id of its address, so the browser can gather the
    # incidents at an address exactly. Map positions cannot do that: APD has
    # re-geocoded addresses over time, so one address has several positions.
    # Ids are handed out busiest first, which needs a first pass over the data.
    address_counts: Counter[str] = Counter()
    for path in month_files:
        for row in read_csv(path)[1]:
            if local_parts(row.get("ReportDate", "")) is not None:
                address_counts[clean_address(row.get("StreetAddress", ""))] += 1
    address_ids = number_addresses(address_counts)
    if len(address_ids) >= 1 << 24:
        raise SystemExit("address ids outgrew their 24-bit column; widen the format")

    years: dict[int, dict] = {}
    # address -> (id, x, y) at its most recently reported position (for search)
    places: dict[str, tuple[int, int, int]] = {}
    area_positions: dict[str, dict[int, set[tuple[int, int]]]] = {
        "nhood": {},
        "npu": {},
        "zone": {},
    }
    total = unmapped = 0
    last_report: datetime | None = None
    digest = hashlib.sha256()

    by_year: dict[int, list[Path]] = {}
    for path in month_files:
        by_year.setdefault(int(path.parent.name), []).append(path)

    for year, paths in by_year.items():
        day, minute, xs, ys, nhood, addr_lo = (array("H") for _ in range(6))
        offense, npu, zone, flags, occ_hour, occ_dow, addr_hi = (array("B") for _ in range(7))
        months = []
        for path in paths:
            _, rows = read_csv(path)
            detail = {k: [] for k in ("inc", "rep", "addr", "from", "to", "loc", "beat", "vic")}
            kept = 0
            previous_report = None
            for row in rows:
                reported = local_parts(row.get("ReportDate", ""))
                if reported is None:
                    continue
                kept += 1
                if last_report is None or reported > last_report:
                    last_report = reported
                day.append((reported.date() - EPOCH).days)
                minute.append(reported.hour * 60 + reported.minute)

                x = quantize(row.get("Longitude", ""), BBOX["west"], BBOX["east"])
                y = quantize(row.get("Latitude", ""), BBOX["south"], BBOX["north"])
                address = clean_address(row.get("StreetAddress", ""))
                address_id = address_ids[address]
                # 24 bits, split across a 16-bit and an 8-bit column.
                addr_lo.append(address_id & 0xFFFF)
                addr_hi.append(address_id >> 16)
                if x is None or y is None:
                    x = y = NO_COORD
                    unmapped += 1
                elif address_id:
                    # Rows arrive oldest first, so the last position kept is the current one.
                    places[address] = (address_id, x, y)
                xs.append(x)
                ys.append(y)

                name = row.get("NIBRS_Offense", "") or UNCLASSIFIED_NAME
                if name not in offenses.ids:
                    against = row.get("Crime_Against", "")
                    offense_info.append(
                        {
                            "name": name,
                            "code": row.get("NibrsUcrCode", ""),
                            "bucket": row.get("NIBRS_Bucket", "") or name,
                            "part1": row.get("Part") == "Part I",
                            "group": GROUPS.index(against)
                            if against in GROUPS
                            else UNCLASSIFIED_GROUP,
                        }
                    )
                offense.append(offenses.id(name))
                area_ids = {
                    "nhood": nhoods.id(row.get("NhoodName", "")),
                    "npu": npus.id(row.get("NPU", "")),
                    "zone": zones.id(row.get("Zone", "")),
                }
                nhood.append(area_ids["nhood"])
                npu.append(area_ids["npu"])
                zone.append(area_ids["zone"])
                if x != NO_COORD:
                    # Every position ever recorded in an area, to outline it (id 0 is "none").
                    for kind, area_id in area_ids.items():
                        if area_id:
                            area_positions[kind].setdefault(area_id, set()).add((x, y))
                incident = row.get("IncidentNumber", "")
                this_report = (row.get("ReportDate", ""), incident)
                flags.append(
                    (FLAG_FIREARM if row.get("FireArmInvolved") == "yes" else 0)
                    | (FLAG_FAMILY_VIOLENCE if row.get("GAFamilyViolenceIndicator") == "YES" else 0)
                    | (FLAG_PART_ONE if row.get("Part") == "Part I" else 0)
                    | (FLAG_SAME_INCIDENT if incident and this_report == previous_report else 0)
                )
                previous_report = this_report

                occurred = local_parts(row.get("OccurredFromDate", ""))
                if occurred is None:
                    occ_hour.append(UNKNOWN_U8)
                    occ_dow.append(UNKNOWN_U8)
                else:
                    occ_hour.append(occurred.hour)
                    occ_dow.append((occurred.weekday() + 1) % 7)  # Sunday = 0

                detail["inc"].append(incident)
                # Report numbers are "<incident>-<n>": n is 1 for the original
                # report and counts up with each supplement. Only n is stored.
                report_number = row.get("ReportNumber", "")
                prefix = incident + "-"
                detail["rep"].append(
                    report_number[len(prefix) :] if report_number.startswith(prefix) else ""
                )
                detail["addr"].append(row.get("StreetAddress", ""))
                detail["from"].append(row.get("OccurredFromDate", "")[:16])
                detail["to"].append(row.get("OccurredToDate", "")[:16])
                detail["loc"].append(location_types.id(row.get("LocationType", "")))
                detail["beat"].append(row.get("BEAT", ""))
                detail["vic"].append(row.get("Vic_Count", ""))

            if kept == 0:
                continue
            text = json.dumps(detail, separators=(",", ":"), ensure_ascii=False)
            (out_dir / "detail" / f"{path.stem}.json").write_text(text, encoding="utf-8")
            digest.update(text.encode("utf-8"))
            months.append({"month": path.stem, "count": kept})

        count = len(day)
        if count == 0:
            continue
        if len(offenses.ids) > 255 or max(len(d.ids) for d in (npus, zones)) > 255:
            raise SystemExit("a dictionary outgrew its 8-bit column; widen the format")
        if len(nhoods.ids) > 65535:
            raise SystemExit("neighborhood dictionary outgrew its 16-bit column")
        blob = encode_points(
            [day, minute, xs, ys, nhood, addr_lo],
            [offense, npu, zone, flags, occ_hour, occ_dow, addr_hi],
            count,
        )
        (out_dir / f"points-{year}.bin").write_bytes(blob)
        digest.update(blob)
        years[year] = {"year": year, "count": count, "months": months}
        total += count

    assert last_report is not None
    search_text = json.dumps(
        build_search_index(places, address_counts), separators=(",", ":"), ensure_ascii=False
    )
    (out_dir / "search.json").write_text(search_text, encoding="utf-8")
    digest.update(search_text.encode("utf-8"))

    manifest = {
        "version": FORMAT_VERSION,
        # Content hash: lets the browser cache data files until they change.
        "build": digest.hexdigest()[:12],
        "epoch": EPOCH.isoformat(),
        "through": last_report.date().isoformat(),
        "count": total,
        "unmapped": unmapped,
        "bbox": BBOX,
        "coordSteps": COORD_STEPS,
        "groups": [*GROUPS, UNCLASSIFIED_NAME],
        "offenses": offense_info,
        "nhoods": nhoods.values,
        "npus": npus.values,
        "zones": zones.values,
        # Per area, an outline around every incident position recorded in it.
        "outlines": {
            "nhood": outlines(area_positions["nhood"], len(nhoods.values)),
            "npu": outlines(area_positions["npu"], len(npus.values)),
            "zone": outlines(area_positions["zone"], len(zones.values)),
        },
        "locationTypes": [title_case_code(v) for v in location_types.values],
        "years": [years[y] for y in sorted(years)],
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    return manifest
