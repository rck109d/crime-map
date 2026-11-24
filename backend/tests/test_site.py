from __future__ import annotations

import gzip
import json
import struct
from array import array
from datetime import datetime

from crimemap.cli import build_parser, load
from crimemap.records import ATLANTA
from crimemap.site import BBOX, COORD_STEPS, NO_COORD, build_site

NOW = datetime(2026, 11, 22, 17, 0, tzinfo=ATLANTA)


def archive(tmp_path, layer):
    args = build_parser().parse_args(
        [
            "load",
            "--data-dir",
            str(tmp_path / "data"),
            "--start",
            "2026-09-01",
            "--end",
            "2026-11-22",
        ]
    )
    assert load(args, layer=layer, now=NOW, sleep=lambda s: None) == 0
    return tmp_path / "data"


def read_points(path):
    raw = path.read_bytes()
    assert raw[:2] == b"\x1f\x8b"  # stored gzip-compressed
    body = gzip.decompress(raw)
    magic, version, _, count = struct.unpack_from("<4sHHI", body)
    assert (magic, version) == (b"CMAP", 3)
    assert len(body) == 12 + count * 19
    cols, offset = {}, 12
    for name in ("day", "minute", "x", "y", "nhood", "addr_lo"):
        col = array("H")
        col.frombytes(body[offset : offset + count * 2])
        cols[name], offset = list(col), offset + count * 2
    for name in ("offense", "npu", "zone", "flags", "occ_hour", "occ_dow", "addr_hi"):
        cols[name], offset = list(body[offset : offset + count]), offset + count
    cols["address"] = [
        lo | (hi << 16) for lo, hi in zip(cols["addr_lo"], cols["addr_hi"], strict=True)
    ]
    return count, cols


def test_site_files_match_the_archive(tmp_path, layer, server, records):
    # One record far outside the city: published, but without a map position.
    server.records.append(dict(records[5], OBJECTID=1, IncidentNumber="FAR", Longitude=-74.1))
    out = tmp_path / "site"
    manifest = build_site(archive(tmp_path, layer), out)

    assert manifest["count"] == len(records) + 1
    assert manifest["unmapped"] == 1
    assert manifest["through"] == "2026-10-31"
    assert [y["year"] for y in manifest["years"]] == [2026]
    months = manifest["years"][0]["months"]
    assert [m["month"] for m in months] == ["2026-09", "2026-10"]

    count, cols = read_points(out / "points-2026.bin")
    assert count == manifest["count"] == sum(m["count"] for m in months)
    assert cols["day"] == sorted(cols["day"])
    assert cols["day"][0] == (datetime(2026, 9, 30) - datetime(1997, 1, 1)).days
    assert cols["minute"][0] == 20 * 60 + 9  # 8:09 PM Atlanta time, not UTC
    assert cols["x"].count(NO_COORD) == 1

    # Coordinates survive quantization to within a metre or so.
    first = next(r for r in records if r["IncidentNumber"] == "262755020")
    lng = BBOX["west"] + cols["x"][0] / COORD_STEPS * (BBOX["east"] - BBOX["west"])
    lat = BBOX["south"] + cols["y"][0] / COORD_STEPS * (BBOX["north"] - BBOX["south"])
    assert abs(lng - first["Longitude"]) < 1e-5
    assert abs(lat - first["Latitude"]) < 1e-5

    # Dictionaries resolve back to the archived text.
    offense = manifest["offenses"][cols["offense"][0]]
    assert offense["name"] == first["NIBRS_Offense"]
    assert manifest["groups"][offense["group"]] == first["Crime_Against"]
    assert manifest["nhoods"][cols["nhood"][0]] == (first["NhoodName"] or "")
    assert manifest["zones"][cols["zone"][0]] == (first["Zone"] or "")

    # Flags: firearm = 1, family violence = 2, UCR Part I = 4.
    order = [
        inc
        for month in months
        for inc in json.loads((out / "detail" / f"{month['month']}.json").read_text())["inc"]
    ]
    checked = 0
    for i, inc in enumerate(order):
        sources = [r for r in server.records if r["IncidentNumber"] == inc]
        if len(sources) != 1:
            continue  # several offenses share this incident number
        (source,) = sources
        assert bool(cols["flags"][i] & 1) == (source["FireArmInvolved"] == "yes")
        assert bool(cols["flags"][i] & 2) == (source["GAFamilyViolenceIndicator"] == "YES")
        assert bool(cols["flags"][i] & 4) == (source["Part"] == "Part I")
        checked += 1
    assert checked >= 5
    assert offense["part1"] == (first["Part"] == "Part I")

    # Flag 8 joins the offenses of one report: the three rows of incident
    # 262821556 form one run, and no other row continues its predecessor.
    joined = [bool(f & 8) for f in cols["flags"]]
    first_of_three = order.index("262821556")
    assert order[first_of_three : first_of_three + 3] == ["262821556"] * 3
    assert joined[first_of_three : first_of_three + 3] == [False, True, True]
    assert sum(joined) == 2
    reports = [
        rep
        for month in months
        for rep in json.loads((out / "detail" / f"{month['month']}.json").read_text())["rep"]
    ]
    assert reports[first_of_three] == "1"  # report number 262821556-1

    # Detail rows line up with the points table, month by month.
    row = 0
    for month in months:
        detail = json.loads((out / "detail" / f"{month['month']}.json").read_text())
        assert all(len(v) == month["count"] for v in detail.values())
        if row == 0:
            assert detail["inc"][0] == "262755020"
            assert detail["addr"][0] == first["StreetAddress"]
            assert len(detail["from"][0]) == 16  # local wall-clock time, no offset
        row += month["count"]


def test_rebuild_is_stable_and_clears_stale_files(tmp_path, layer):
    out = tmp_path / "site"
    data = archive(tmp_path, layer)
    first = build_site(data, out)
    (out / "points-1999.bin").write_bytes(b"stale")
    (out / "detail" / "1999-01.json").write_text("{}")
    again = build_site(data, out)
    assert again["build"] == first["build"]  # same data, same cache key
    assert not (out / "points-1999.bin").exists()
    assert not (out / "detail" / "1999-01.json").exists()


def test_unclassified_records_get_their_own_group(tmp_path, layer, server, records):
    blank = dict(
        records[5],
        OBJECTID=2,
        IncidentNumber="NA1",
        NIBRS_Offense=None,
        NIBRS_Bucket=None,
        Crime_Against=None,
        NibrsUcrCode="NOT_APPL",
    )
    server.records.append(blank)
    manifest = build_site(archive(tmp_path, layer), tmp_path / "site")
    unclassified = next(o for o in manifest["offenses"] if o["code"] == "NOT_APPL")
    assert unclassified["name"] == "Unclassified"
    assert manifest["groups"][unclassified["group"]] == "Unclassified"


def test_search_index_groups_addresses_by_street():
    from collections import Counter

    from crimemap.search_index import build_search_index, clean_address, number_addresses

    assert clean_address("4305  CROSSWIND RD ") == "4305 CROSSWIND RD"
    counts = Counter(
        {
            "3393 PEACHTREE RD NE": 7,
            "25 PEACHTREE RD NE": 1,
            "64 HOGUE ST NE": 3,
            "PRYOR ST / BASS ST": 4,
            "N/A": 99,
            "": 5,
        }
    )
    ids = number_addresses(counts)
    # Busiest real address first; placeholders share id 0 however common they are.
    assert ids == {
        "3393 PEACHTREE RD NE": 1,
        "PRYOR ST / BASS ST": 2,
        "64 HOGUE ST NE": 3,
        "25 PEACHTREE RD NE": 4,
        "N/A": 0,
        "": 0,
    }
    places = {
        "3393 PEACHTREE RD NE": (1, 10, 20),
        "25 PEACHTREE RD NE": (4, 30, 40),
        "64 HOGUE ST NE": (3, 50, 60),
        "PRYOR ST / BASS ST": (2, 70, 80),
    }
    index = build_search_index(places, counts)
    assert [s["n"] for s in index["streets"]] == ["PEACHTREE RD NE", "HOGUE ST NE"]
    peachtree = index["streets"][0]
    assert peachtree["c"] == 8
    # number, x, y, incidents, id; sorted by house number
    assert peachtree["a"] == [25, 30, 40, 1, 4, 3393, 10, 20, 7, 1]
    assert index["crossings"] == [["PRYOR ST / BASS ST", 70, 80, 4, 2]]


def test_rows_carry_their_address_id_and_search_points_at_the_latest_position(
    tmp_path, layer, server, records
):
    # The same address, re-geocoded 100 m away in a later report.
    first = next(r for r in records if r["IncidentNumber"] == "262755020")
    moved = dict(
        records[-1],
        OBJECTID=900,
        IncidentNumber="MOVED",
        StreetAddress=first["StreetAddress"],
        Longitude=first["Longitude"] + 0.001,
        Latitude=first["Latitude"],
    )
    server.records.append(moved)
    out = tmp_path / "site"
    manifest = build_site(archive(tmp_path, layer), out)
    _, cols = read_points(out / "points-2026.bin")
    months = manifest["years"][0]["months"]
    order = [
        inc
        for month in months
        for inc in json.loads((out / "detail" / f"{month['month']}.json").read_text())["inc"]
    ]
    old_row, new_row = order.index("262755020"), order.index("MOVED")
    assert cols["address"][old_row] == cols["address"][new_row] != 0
    assert cols["x"][old_row] != cols["x"][new_row]

    index = json.loads((out / "search.json").read_text())
    number, street = first["StreetAddress"].split(" ", 1)
    entry = next(s for s in index["streets"] if s["n"] == street)
    at = entry["a"].index(int(number))
    _, x, y, count, address_id = entry["a"][at : at + 5]
    assert address_id == cols["address"][new_row]
    assert count == 2
    assert (x, y) == (cols["x"][new_row], cols["y"][new_row])  # where it is reported now


def test_convex_hull_and_outlines():
    from crimemap.hull import convex_hull, outlines

    square = [(0, 0), (4, 0), (4, 4), (0, 4)]
    inside = [(1, 1), (2, 3), (2, 2), (4, 2)]  # the last lies on an edge
    assert convex_hull(square + inside + square) == [(0, 0), (4, 0), (4, 4), (0, 4)]
    assert convex_hull([(5, 5)]) == [(5, 5)]
    assert convex_hull([(0, 0), (2, 2), (1, 1)]) == [(0, 0), (2, 2)]  # all on one line
    assert convex_hull([]) == []
    # One flat outline per id; ids with nothing mapped get None.
    assert outlines({1: set(square), 3: {(7, 8)}}, 4) == [
        None,
        [0, 0, 4, 0, 4, 4, 0, 4],
        None,
        [7, 8],
    ]


def test_manifest_outlines_cover_each_areas_incidents(tmp_path, layer, records):
    manifest = build_site(archive(tmp_path, layer), tmp_path / "site")
    _, cols = read_points(tmp_path / "site" / "points-2026.bin")
    for kind, names in (("nhood", "nhoods"), ("npu", "npus"), ("zone", "zones")):
        rings = manifest["outlines"][kind]
        assert len(rings) == len(manifest[names])
        assert rings[0] is None  # id 0 means no area was recorded
        for area_id, ring in enumerate(rings):
            rows = [
                i for i, v in enumerate(cols[kind]) if v == area_id and cols["x"][i] != NO_COORD
            ]
            if area_id == 0 or not rows:
                continue
            xs, ys = ring[0::2], ring[1::2]
            for i in rows:  # every incident of the area lies within its outline's extent
                assert min(xs) <= cols["x"][i] <= max(xs)
                assert min(ys) <= cols["y"][i] <= max(ys)
