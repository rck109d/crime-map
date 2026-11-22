from __future__ import annotations

import csv
import json
from datetime import datetime

import pytest

from crimemap import arcgis
from crimemap.cli import build_parser, load
from crimemap.records import ATLANTA, epoch_ms_to_iso, partition_for

NOW = datetime(2026, 11, 22, 17, 0, tzinfo=ATLANTA)


def run(tmp_path, layer, *argv):
    args = build_parser().parse_args(["load", "--data-dir", str(tmp_path), *argv])
    return load(args, layer=layer, now=NOW, sleep=lambda seconds: None)


def read(path):
    with path.open(newline="") as fh:
        return list(csv.DictReader(fh))


def read_all(tmp_path):
    return [r for p in sorted((tmp_path / "nibrs").glob("2*/*.csv")) for r in read(p)]


def snapshot(tmp_path):
    return {
        p.relative_to(tmp_path).as_posix(): p.read_bytes()
        for p in sorted(tmp_path.rglob("*"))
        if p.is_file()
    }


def test_epoch_is_converted_to_atlanta_time_with_offset():
    # 2026-10-30 14:00 UTC is 10:00 EDT; 2026-11-03 12:00 UTC is 07:00 EST
    assert epoch_ms_to_iso(1793368800000) == "2026-10-30T10:00:00-04:00"
    assert epoch_ms_to_iso(1793707200000) == "2026-11-03T07:00:00-05:00"


def test_partition_uses_local_date_and_flags_bad_dates():
    # 2026-11-01 02:30 UTC is still October 31 in Atlanta
    assert partition_for({"ReportDate": epoch_ms_to_iso(1793500200000)}, NOW) == "2026-10"
    assert partition_for({"ReportDate": "1015-06-01T00:00:00-05:00"}, NOW) == "unusual-dates"
    assert partition_for({"ReportDate": "2124-01-01T00:00:00-05:00"}, NOW) == "unusual-dates"
    assert partition_for({"ReportDate": ""}, NOW) == "unusual-dates"


def test_window_load_writes_sorted_monthly_csv(tmp_path, layer, records):
    assert run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22") == 0
    # records 3 and 4 were reported the evening of Sept 30 in Atlanta, Oct 1 in UTC
    sept = read(tmp_path / "nibrs/2026/2026-09.csv")
    octo = read(tmp_path / "nibrs/2026/2026-10.csv")
    assert [r["IncidentNumber"] for r in sept] == [
        records[3]["IncidentNumber"],
        records[4]["IncidentNumber"],
    ]
    assert len(octo) == len(records) - 2
    assert "OBJECTID" not in octo[0]
    assert [r["ReportDate"] for r in octo] == sorted(r["ReportDate"] for r in octo)
    assert sept[0]["Longitude"] == repr(float(records[3]["Longitude"]))
    source = json.loads((tmp_path / "nibrs/source.json").read_text())
    assert source["fields"][0]["name"] == "OBJECTID"


def test_rerun_without_source_changes_is_byte_identical(tmp_path, layer):
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    first = snapshot(tmp_path)
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    assert snapshot(tmp_path) == first


def test_reclassified_and_removed_records_are_mirrored(tmp_path, layer, server, records):
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    server.records[0]["NIBRS_Offense"] = "Reclassified"
    removed = server.records.pop(1)
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    rows = read_all(tmp_path)
    keys = {(r["IncidentNumber"], r["NibrsUcrCode"]) for r in rows}
    assert (removed["IncidentNumber"], removed["NibrsUcrCode"]) not in keys
    assert "Reclassified" in {r["NIBRS_Offense"] for r in rows}
    assert len(rows) == len(records) - 1


def test_window_leaves_rows_outside_it_alone(tmp_path, layer, server):
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    before = read(tmp_path / "nibrs/2026/2026-10.csv")
    server.records.clear()  # source now empty, but only Nov 20-22 is refreshed
    run(tmp_path, layer, "--start", "2026-11-20", "--end", "2026-11-22")
    assert read(tmp_path / "nibrs/2026/2026-10.csv") == before


def test_window_never_deletes_older_rows_sharing_a_key(tmp_path, layer, server):
    # The live layer has reused incident numbers months apart; a window refresh
    # must not treat the older report as a stale copy of the new one.
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    reused = dict(server.records[3], OBJECTID=99, ReportDate=1795000000000)  # Nov 17
    server.records.append(reused)
    run(tmp_path, layer, "--start", "2026-11-01", "--end", "2026-11-22")
    sept = {r["IncidentNumber"] for r in read(tmp_path / "nibrs/2026/2026-09.csv")}
    nov = {r["IncidentNumber"] for r in read(tmp_path / "nibrs/2026/2026-11.csv")}
    assert reused["IncidentNumber"] in sept
    assert reused["IncidentNumber"] in nov


def test_source_duplicate_rows_are_kept(tmp_path, layer, server, records):
    server.records.append(dict(server.records[0], OBJECTID=77))
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    assert len(read_all(tmp_path)) == len(records) + 1


def test_full_load_keeps_unusual_dates(tmp_path, layer, server, records):
    odd = dict(records[4], OBJECTID=1, IncidentNumber="X1", ReportDate=-30128638556000)
    server.records.append(odd)
    assert run(tmp_path, layer, "--all") == 0
    unusual = read(tmp_path / "nibrs/unusual-dates.csv")
    assert [r["IncidentNumber"] for r in unusual] == ["X1"]
    assert len(read_all(tmp_path)) == len(records)


def test_refuses_to_shrink_archive_without_force(tmp_path, layer, server, records):
    base = records[5]  # October
    server.records[:] = [dict(base, OBJECTID=i, IncidentNumber=f"N{i}") for i in range(300)]
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    del server.records[100:]
    assert run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22") == 3
    assert len(read(tmp_path / "nibrs/2026/2026-10.csv")) == 300
    assert run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22", "--force") == 0
    assert len(read(tmp_path / "nibrs/2026/2026-10.csv")) == 100


def test_paging_retries_when_layer_is_republished_mid_fetch(layer, server, monkeypatch):
    monkeypatch.setattr(arcgis.time, "sleep", lambda s: None)
    state = {"done": False}

    def republish(srv, offset):
        if offset > 0 and not state["done"]:
            state["done"] = True
            for r in srv.records:
                r["OBJECTID"] += 1000  # new ids, so the pages would overlap
            srv.records.append(dict(srv.records[0], OBJECTID=5000, IncidentNumber="NEW"))

    server.on_page = republish
    where = arcgis.range_where(datetime(2026, 9, 1, tzinfo=ATLANTA), NOW)
    got = layer.query_all(where)
    assert len(got) == len(server.records)
    assert "NEW" in {r["IncidentNumber"] for r in got}


def test_large_ranges_are_split(layer, server, records, monkeypatch):
    monkeypatch.setattr(arcgis, "CHUNK_MAX_RECORDS", 3)
    got = layer.query_range(datetime(2026, 9, 1, tzinfo=ATLANTA), NOW)
    assert sorted(r["OBJECTID"] for r in got) == sorted(r["OBJECTID"] for r in records)


@pytest.mark.parametrize("bad", ["2026-13-01", "11/01/2026"])
def test_rejects_bad_dates(bad):
    with pytest.raises(SystemExit):
        build_parser().parse_args(["load", "--start", bad])


def test_http_retries_dropped_connections(monkeypatch):
    monkeypatch.setattr(arcgis.time, "sleep", lambda s: None)
    calls = []

    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        headers = {"Last-Modified": "Sun, 22 Nov 2026 23:19:05 GMT"}

        def read(self, *a):
            return b'{"count": 7}'

    def fake_urlopen(req, timeout):
        calls.append(req.full_url)
        if len(calls) == 1:
            raise ConnectionResetError("reset mid-body")
        if len(calls) == 2:
            raise arcgis.http.client.IncompleteRead(b"")
        return Resp()

    monkeypatch.setattr(arcgis.urllib.request, "urlopen", fake_urlopen)
    body = arcgis.http_get_json("https://example.invalid/q", {"where": "1=1"})
    assert body == {"count": 7, arcgis.VERSION_KEY: "Sun, 22 Nov 2026 23:19:05 GMT"}
    assert len(calls) == 3


def _fill(server, records, n=300):
    server.records[:] = [dict(records[5], OBJECTID=i, IncidentNumber=f"N{i}") for i in range(n)]


def test_fetch_is_repeated_when_layer_is_republished(tmp_path, layer, server, records):
    # APD's hourly republish: the layer empties, then comes back as a new version.
    _fill(server, records)
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    saved = list(server.records)
    server.calls = 0

    def republish(srv):
        if srv.calls == 3:
            srv.records.clear()
        if srv.calls == 12:
            srv.records.extend(saved)
            srv.records.append(dict(saved[0], OBJECTID=999, IncidentNumber="NEW"))
            srv.version = "v2"

    server.on_call = republish
    assert run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22") == 0
    assert len(read_all(tmp_path)) == 301


def test_partial_republish_is_not_written(tmp_path, layer, server, records):
    # Half-loaded layer: internally consistent, but far short of the archive.
    _fill(server, records)
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    first = snapshot(tmp_path)
    del server.records[150:]
    assert run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22") == 3
    assert snapshot(tmp_path) == first


def test_growing_layer_is_not_written(tmp_path, layer, server, records):
    # Still loading: the count after the pause no longer matches what was fetched.
    _fill(server, records)
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    first = snapshot(tmp_path)
    saved = list(server.records)
    del server.records[280:]
    real_sleep = {"n": 0}

    def sleep(seconds):
        real_sleep["n"] += 1
        if len(server.records) < len(saved) - 1:
            server.records.append(saved[len(server.records)])

    args = build_parser().parse_args(
        ["load", "--data-dir", str(tmp_path), "--start", "2026-09-01", "--end", "2026-11-22"]
    )
    assert load(args, layer=layer, now=NOW, sleep=sleep) == 4
    assert snapshot(tmp_path) == first


def test_gives_up_without_writing_if_source_never_settles(tmp_path, layer, server):
    run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22")
    first = snapshot(tmp_path)

    def churn(srv):
        srv.version = f"v{srv.calls}"

    server.on_call = churn
    del server.records[2:]
    assert run(tmp_path, layer, "--start", "2026-09-01", "--end", "2026-11-22") == 4
    assert snapshot(tmp_path) == first
