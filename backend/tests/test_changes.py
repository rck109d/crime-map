from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta

from crimemap import changes
from crimemap.cli import build_parser, load
from crimemap.records import ATLANTA

NOW = datetime(2026, 11, 22, 17, 0, tzinfo=ATLANTA)
WINDOW = ["--start", "2026-09-01", "--end", "2026-11-22"]


def run(tmp_path, layer, *argv, now=NOW):
    args = build_parser().parse_args(["load", "--data-dir", str(tmp_path), *argv])
    return load(args, layer=layer, now=now, sleep=lambda seconds: None)


def log(tmp_path):
    rows = []
    for path in sorted((tmp_path / "nibrs-changes").rglob("*.csv")):
        with path.open(newline="") as fh:
            rows += list(csv.DictReader(fh))
    return rows


def archived(tmp_path):
    rows = []
    for path in sorted((tmp_path / "nibrs").rglob("*.csv")):
        with path.open(newline="") as fh:
            rows += list(csv.DictReader(fh))
    return rows


def test_nothing_is_logged_when_nothing_changes(tmp_path, layer, server):
    run(tmp_path, layer, *WINDOW)
    server.records.append(dict(server.records[5], OBJECTID=50, IncidentNumber="BRAND-NEW"))
    run(tmp_path, layer, *WINDOW)  # a new report is not a change to an old one
    run(tmp_path, layer, *WINDOW)
    assert not (tmp_path / "nibrs-changes").exists()


def test_edited_record_keeps_its_old_version(tmp_path, layer, server):
    run(tmp_path, layer, *WINDOW)
    target = server.records[5]
    old_address = target["StreetAddress"]
    target["StreetAddress"] = "1 NEW ADDRESS ST"
    target["NhoodName"] = "Elsewhere"
    later = NOW + timedelta(days=1)
    run(tmp_path, layer, *WINDOW, now=later)

    (entry,) = log(tmp_path)
    assert entry["change"] == "changed"
    assert entry["observed_at"] == later.isoformat(timespec="seconds")
    assert entry["IncidentNumber"] == target["IncidentNumber"]
    assert entry["StreetAddress"] == old_address  # the row as it was
    assert json.loads(entry["new_values"]) == {
        "NhoodName": "Elsewhere",
        "StreetAddress": "1 NEW ADDRESS ST",
    }
    current = [r for r in archived(tmp_path) if r["IncidentNumber"] == target["IncidentNumber"]]
    assert [r["StreetAddress"] for r in current] == ["1 NEW ADDRESS ST"]
    assert (tmp_path / "nibrs-changes/2026/2026-11.csv").exists()


def test_removed_incident_and_removed_offense_are_told_apart(tmp_path, layer, server, records):
    run(tmp_path, layer, *WINDOW)
    multi = [r for r in server.records if r["IncidentNumber"] == "262821556"]
    single = server.records[5]
    assert len(multi) == 3
    server.records.remove(multi[0])  # one offense of three dropped
    server.records.remove(single)  # a whole incident dropped
    run(tmp_path, layer, *WINDOW)

    by_change = {e["change"]: e for e in log(tmp_path)}
    assert set(by_change) == {"removed", "offense_removed"}
    assert by_change["removed"]["IncidentNumber"] == single["IncidentNumber"]
    assert by_change["offense_removed"]["NibrsUcrCode"] == multi[0]["NibrsUcrCode"]
    assert by_change["removed"]["new_values"] == ""
    assert len(archived(tmp_path)) == len(records) - 2


def test_reclassified_offense_is_logged_as_removed_from_a_surviving_incident(
    tmp_path, layer, server
):
    run(tmp_path, layer, *WINDOW)
    target = server.records[5]
    old_code = target["NibrsUcrCode"]
    target["NibrsUcrCode"], target["NIBRS_Offense"] = "13A", "Aggravated Assault"
    run(tmp_path, layer, *WINDOW)
    (entry,) = log(tmp_path)
    assert (entry["change"], entry["NibrsUcrCode"]) == ("offense_removed", old_code)


def test_removed_duplicate_is_labelled_as_one(tmp_path, layer, server):
    twin = dict(server.records[5], OBJECTID=77)
    server.records.append(twin)
    run(tmp_path, layer, *WINDOW)
    server.records.remove(twin)
    run(tmp_path, layer, *WINDOW)
    assert [e["change"] for e in log(tmp_path)] == ["duplicate_removed"]


def test_only_rows_inside_the_refreshed_window_are_compared(tmp_path, layer, server):
    run(tmp_path, layer, *WINDOW)
    server.records.clear()  # everything "vanishes", but only late November is refreshed
    run(tmp_path, layer, "--start", "2026-11-20", "--end", "2026-11-22")
    assert not (tmp_path / "nibrs-changes").exists()


def test_full_reload_logs_changes_to_old_months(tmp_path, layer, server):
    run(tmp_path, layer, "--all")
    gone = server.records.pop(3)  # reported in September
    run(tmp_path, layer, "--all", "--force")
    (entry,) = log(tmp_path)
    assert (entry["change"], entry["IncidentNumber"]) == ("removed", gone["IncidentNumber"])


def test_new_source_column_is_not_an_edit_to_every_row(tmp_path, layer, server):
    run(tmp_path, layer, *WINDOW)
    server.meta["fields"].append({"name": "NewColumn", "type": "esriFieldTypeString"})
    for record in server.records:
        record["NewColumn"] = "x"
    layer._meta = None  # the loader reads the layer's fields once per run
    run(tmp_path, layer, *WINDOW)
    assert not (tmp_path / "nibrs-changes").exists()
    assert archived(tmp_path)[0]["NewColumn"] == "x"


def test_log_appends_and_rolls_over_before_files_get_too_big(tmp_path, monkeypatch):
    monkeypatch.setattr(changes, "MAX_ROWS_PER_FILE", 3)
    directory = tmp_path / "nibrs-changes"
    columns = ["IncidentNumber", "NibrsUcrCode"]

    def entries(start, n):
        return [
            ("removed", {"IncidentNumber": str(i), "NibrsUcrCode": "13B"}, {})
            for i in range(start, start + n)
        ]

    assert changes.append_changes(directory, entries(0, 2), columns, NOW) == 2
    assert changes.append_changes(directory, entries(2, 5), columns, NOW) == 5
    files = sorted(p.name for p in (directory / "2026").iterdir())
    assert files == ["2026-11.csv", "2026-11.part2.csv", "2026-11.part3.csv"]
    assert [r["IncidentNumber"] for r in log(tmp_path)] == [str(i) for i in range(7)]
    assert changes.append_changes(directory, [], columns, NOW) == 0
