from __future__ import annotations

import json
import re
from datetime import UTC, datetime

from test_site import archive, read_points

from crimemap.arcgis import Layer
from crimemap.historical import classify_code, classify_type, load_historical
from crimemap.site import UNKNOWN_MINUTE, build_site
from crimemap.store import read_csv


def ms(text: str) -> int:
    return int(datetime.fromisoformat(text).astimezone(UTC).timestamp() * 1000)


def fake_layer(rows: list[dict], fields: list[str]) -> Layer:
    """A static layer answering the object-id range queries the loader makes."""
    for i, row in enumerate(rows, start=1):
        row.setdefault("ObjectId", i)

    def fetch(url: str, params: dict[str, str]) -> dict:
        if not url.endswith("/query"):
            return {
                "objectIdField": "ObjectId",
                "maxRecordCount": 2,
                "fields": [{"name": f, "type": "esriFieldTypeString"} for f in fields],
            }
        where = params["where"]
        if where == "1=1":
            hits = rows
        else:
            low, high = map(
                int, re.fullmatch(r"ObjectId > (\d+) AND ObjectId <= (\d+)", where).groups()
            )
            hits = [r for r in rows if low < r["ObjectId"] <= high]
        if params.get("returnCountOnly") == "true":
            return {"count": len(hits)}
        off, n = int(params["resultOffset"]), int(params["resultRecordCount"])
        return {
            "features": [{"attributes": dict(r)} for r in hits[off : off + n]],
            "exceededTransferLimit": off + n < len(hits),
        }

    return Layer("https://example.invalid/FeatureServer/0", fetch=fetch)


def old_record(**fields) -> dict:
    base = {
        "Incident__": "990400571",
        "Offense_Description": "ROB-STREET-GUN",
        "UC2literal": "ROBBERY-PEDESTRIAN",
        "Report_date1": ms("1999-02-09T00:00:00-05:00"),
        "Date_From1": ms("1999-02-08T00:00:00-05:00"),
        "Time_From": ms("2023-01-07T20:00:00-05:00"),
        "Date_To1": ms("1999-02-09T00:00:00-05:00"),
        "Time_To": ms("2023-01-07T08:30:00-05:00"),
        "Address": "3636 HABERSHAM RD NW",
        "CJIS_beat": 202,
        "CJIS_zone": 2,
        "NPU": "A",
        "NHood": "Tuxedo Park",
        "Longitude": -84.384,
        "Latitude": 33.8528,
    }
    return {**base, **fields}


def new_record(**fields) -> dict:
    base = {
        "Report_Number": "160641209",
        "Report_Date": ms("2016-03-04T00:00:00+00:00"),  # this layer stores UTC midnight
        "Occur_Date": "3/3/2016",
        "Occur_Time": "18:00",
        "Possible_Date": "3/4/2016",
        "Possible_Time": "05:40",
        "Crime_Type": "ROBBERY",
        "NIBRS_Code": "1204",
        "Location": "207 13TH ST NE @CORNER STORE",
        "Apartment_Number": "NULL",
        "Beat": 503,
        "Zone": 5,
        "NPU": "E",
        "Neighborhood": "Midtown",
        "Longitude": -84.38053,
        "Latitude": 33.78518,
    }
    return {**base, **fields}


def test_crime_types_map_to_nibrs_offenses():
    assert classify_type("LARCENY-FROM VEHICLE", "LAR-PARTS FROM VEHICLE").code == "23G"
    assert classify_type("LARCENY-NON VEHICLE", "LAR-BICYCLE").code == "23H"
    assert classify_type("LARCENY-NON VEHICLE", "SHOPLIFTING").code == "23C"
    assert classify_type("BURGLARY-NONRES", "BURG-FORCD ENTRY-NONRESID").code == "220"
    assert classify_type("RAPE", "ATTEMPT RAPE-STRONGARM").code == "11A"
    assert classify_type("MANSLAUGHTER", "NEGL MANSLAUG-GUN/OTH WEP").code == "09B"
    assert classify_type("Homicide", "Willful killing-Gun").code == "09A"
    assert classify_type("AUTO THEFT", "NON-CRIMINAL REPORT").code == ""
    # Names match the NIBRS archive's, so the site merges the eras.
    assert classify_type("AGG ASSAULT", "AGGR ASLT/BATTERY-GUN").name == "Aggravated Assault"


def test_offense_codes_map_to_nibrs_offenses_and_weapons():
    assert classify_code("ROBBERY", "1204") == (classify_type("ROBBERY", ""), "yes")
    assert classify_code("ROBBERY", "1299G")[1] == "yes"
    assert classify_code("ROBBERY", "1206")[1] == "no"  # strongarm
    assert classify_code("ROBBERY", "1205K")[1] == "no"  # knife
    assert classify_code("ROBBERY", "NULL")[1] == ""  # nothing said about the weapon
    assert classify_code("AGG ASSAULT", "1314")[1] == "yes"
    assert classify_code("AGG ASSAULT", "1315K")[1] == "no"
    assert classify_code("AGG ASSAULT", "1399")[1] == ""
    assert classify_code("HOMICIDE", "911")[1] == "yes"
    assert classify_code("HOMICIDE", "912")[1] == "no"
    assert classify_code("LARCENY-FROM VEHICLE", "2304")[0].code == "23G"
    assert classify_code("LARCENY-FROM VEHICLE", "2305")[0].code == "23F"
    assert classify_code("LARCENY-NON VEHICLE", "2308")[0].code == "23D"
    assert classify_code("LARCENY-NON VEHICLE", "23C")[0].code == "23C"
    # A stray code from another category does not override the category.
    assert classify_code("LARCENY-NON VEHICLE", "2404")[0].code == "23H"
    assert classify_code("AUTO THEFT", "2424A") == (classify_type("AUTO THEFT", ""), "no")
    assert classify_code("BURGLARY", "2202A")[0].code == "220"


def layers():
    old = [
        old_record(),
        old_record(),  # an exact repeat, dropped
        old_record(
            Incident__="990400572",
            Offense_Description="SHOPLIFTING",
            UC2literal="LARCENY-NON VEHICLE",
            Longitude=0,
            Latitude=0,
        ),
    ]
    new = [new_record(), new_record(Report_Number="160641210", Occur_Time="NULL")]
    return {
        "1997-2008": fake_layer(old, sorted(old[0])),
        "2009-2020": fake_layer(new, sorted(new[0])),
    }


def test_load_writes_months_with_mapped_and_source_columns(tmp_path):
    counts = load_historical(tmp_path, layers())
    assert counts["rows"] == 4
    assert counts["duplicates"] == 1
    assert counts["unmapped"] == 0

    columns, rows = read_csv(tmp_path / "historical" / "1999" / "1999-02.csv")
    assert columns[:3] == ["Source", "IncidentNumber", "ReportDate"]
    robbery, shoplifting = rows
    assert robbery["ReportDate"] == "1999-02-09"  # Atlanta date, not the UTC one
    assert robbery["OccurredFromDate"] == "1999-02-08T20:00:00-05:00"
    assert robbery["OccurredToDate"] == "1999-02-09T08:30:00-05:00"
    assert robbery["NibrsUcrCode"] == "120"
    assert robbery["FireArmInvolved"] == "yes"
    assert robbery["Zone"] == "Zone 2"
    assert robbery["SourceOffense"] == "ROB-STREET-GUN"
    assert "src_Offense_Description" not in robbery  # carried by SourceOffense
    assert shoplifting["NibrsUcrCode"] == "23C"
    assert shoplifting["Latitude"] == ""  # 0,0 means no position

    _, rows = read_csv(tmp_path / "historical" / "2016" / "2016-03.csv")
    first, second = rows
    assert first["ReportDate"] == "2016-03-04"  # stored as UTC midnight
    assert first["OccurredFromDate"] == "2016-03-03T18:00:00-05:00"
    assert first["StreetAddress"] == "207 13TH ST NE"  # place name after "@" dropped
    assert first["src_Location"] == "207 13TH ST NE @CORNER STORE"
    assert first["src_Apartment_Number"] == ""  # the text "NULL"
    assert first["FireArmInvolved"] == "yes"
    assert second["OccurredFromDate"] == "2016-03-03"  # date known, time not

    # Re-running with fewer months removes the ones that are gone.
    only_new = layers()
    only_new["1997-2008"] = fake_layer([], ["Incident__"])
    load_historical(tmp_path, only_new)
    assert not (tmp_path / "historical" / "1999" / "1999-02.csv").exists()


def test_site_combines_historical_and_nibrs(tmp_path, layer):
    data = archive(tmp_path, layer)
    load_historical(data, layers())
    out = tmp_path / "site"
    manifest = build_site(data, out)

    assert [y["year"] for y in manifest["years"]] == [1999, 2016, 2026]
    assert manifest["epoch"] == "1997-01-01"
    assert manifest["coverage"] == [
        {"source": "historical", "from": "1999-02-09", "to": "2016-03-04"},
        {"source": "nibrs", "from": "2026-09-30", "to": "2026-10-31"},
    ]
    _, cols = read_points(out / "points-2016.bin")
    assert cols["minute"] == [UNKNOWN_MINUTE] * 2  # no report time
    assert cols["occ_hour"] == [18, 255]  # but the occurrence time is known
    assert cols["occ_dow"][0] == 4  # Thursday, 3 March 2016
    assert cols["flags"][0] & 1 and cols["flags"][0] & 4  # firearm, Part I

    robbery = [o for o in manifest["offenses"] if o["name"] == "Robbery"]
    assert len(robbery) == 1 and robbery[0]["code"] == "120"

    detail = json.loads((out / "detail" / "2016-03.json").read_text())
    assert detail["type"] == ["ROBBERY (1204)", "ROBBERY (1204)"]
    assert detail["from"][0] == "2016-03-03T18:00"
    old = json.loads((out / "detail" / "1999-02.json").read_text())
    assert old["type"] == ["ROB-STREET-GUN", "SHOPLIFTING"]
    assert "type" not in json.loads((out / "detail" / "2026-10.json").read_text())
