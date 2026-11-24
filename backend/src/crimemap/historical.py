"""APD's pre-NIBRS incidents, 1997-2020, from its two historical ArcGIS layers.

`crimemap load-historical` fetches both layers and writes
`data/historical/YYYY/YYYY-MM.csv`. APD published them once (January 2023)
and does not update them, so this is a one-off load; re-running it rewrites
the files from the layers as they then stand.

The two layers come from different generations of APD's records system and
share no schema:

    Crime_Data_1997_2008  APD's own crime type ("ROB-STREET-GUN"), a UCR
                          category, report and occurrence dates
    2009_2020CrimeData    a UCR category and an NCIC-style offense code
                          ("1204"; letter suffixes name the weapon), report
                          and occurrence dates as text

Each record is mapped onto the NIBRS offense the current archive (`nibrs/`)
uses for the same crime, so one offense filter covers every year. Both
layers hold only the FBI's index (Part I) crimes. The original fields
that the mapped columns do not already carry are kept, prefixed `src_`.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from .arcgis import Layer
from .records import ATLANTA, Row, format_value
from .store import write_csv

DATASET = "historical"
BASE_URL = "https://services3.arcgis.com/Et5Qfajgiyosiw4d/arcgis/rest/services/"
LAYERS = {
    "1997-2008": BASE_URL + "Crime_Data_1997_2008/FeatureServer/0",
    "2009-2020": BASE_URL + "2009_2020CrimeData/FeatureServer/0",
}
# Fetched in object-id slices so a failed page only repeats a small part.
SLICE = 50_000
# ArcGIS assigns object ids; they mean nothing outside the layer.
DROPPED = frozenset({"ObjectId", "OBJECTID"})
# Source fields kept verbatim as `src_<name>`: those the mapped columns do not
# already carry. (Dates, address parts, coordinates, area names and the
# category/type/code are all in the mapped columns, so they are not repeated.)
KEPT_FIELDS = {
    "1997-2008": [
        "UCR__",  # APD's 3-digit UCR offense code
        "Location",  # location type code
        "Shift",
        "Apt",
        "Intersection",
        "Intersectiontype",
        "Intersectionquad",
        "Weapon",  # weapon code
        "Disp",  # disposition code
        "F__Vics",  # number of victims
        "Current_beat",  # the beat the address was in when the layer was made
        "Current_Zone",
        "Councildist",
    ],
    "2009-2020": [
        "Location",  # address, often with "@ place name"
        "Apartment_Number",
    ],
}

COLUMNS = [
    "Source",
    "IncidentNumber",
    "ReportDate",
    "OccurredFromDate",
    "OccurredToDate",
    "SourceCategory",
    "SourceOffense",
    "NibrsUcrCode",
    "NIBRS_Offense",
    "Crime_Against",
    "Part",
    "NIBRS_Bucket",
    "FireArmInvolved",
    "StreetAddress",
    "Longitude",
    "Latitude",
    "BEAT",
    "Zone",
    "NPU",
    "NhoodName",
]


@dataclass(frozen=True)
class Offense:
    code: str
    name: str
    against: str
    part: str
    bucket: str


# Names, classes and buckets exactly as the NIBRS archive publishes them, so the
# site's offense dictionary merges the eras.
_o = Offense
HOMICIDE = _o("09A", "Murder & Nonnegligent Manslaughter", "Person", "Part I", "Homicide")
NEGLIGENT = _o("09B", "Negligent Manslaughter", "Person", "Part I", "Homicide")
RAPE = _o("11A", "Rape", "Person", "Part I", "Rape")
ROBBERY = _o("120", "Robbery", "Property", "Part I", "Robbery")
AGG_ASSAULT = _o("13A", "Aggravated Assault", "Person", "Part I", "Aggravated Assault")
SIMPLE_ASSAULT = _o("13B", "Simple Assault", "Person", "Part II", "Assault Offenses")
INTIMIDATION = _o("13C", "Intimidation", "Person", "Part II", "Assault Offenses")
BURGLARY = _o("220", "Burglary/Breaking & Entering", "Property", "Part I", "Burglary")
POCKET = _o("23A", "Pocket-picking", "Property", "Part I", "All Other Larceny")
PURSE = _o("23B", "Purse-snatching", "Property", "Part I", "All Other Larceny")
SHOPLIFTING = _o("23C", "Shoplifting", "Property", "Part I", "Shoplifting")
FROM_BUILDING = _o("23D", "Theft From Building", "Property", "Part I", "All Other Larceny")
COIN = _o(
    "23E", "Theft From Coin-Operated Machine or Device", "Property", "Part I", "All Other Larceny"
)
FROM_VEHICLE = _o("23F", "Theft From Motor Vehicle", "Property", "Part I", "Theft From Auto")
PARTS = _o(
    "23G", "Theft of Motor Vehicle Parts or Accessories", "Property", "Part I", "Theft From Auto"
)
OTHER_LARCENY = _o("23H", "All Other Larceny", "Property", "Part I", "All Other Larceny")
VEHICLE_THEFT = _o("240", "Motor Vehicle Theft", "Property", "Part I", "Auto Theft")
FORGERY = _o("250", "Counterfeiting/Forgery", "Property", "Part II", "Counterfeiting/Forgery")
FRAUD = _o(
    "26A", "False Pretenses/Swindle/Confidence Game", "Property", "Part II", "Fraud Offenses"
)
STOLEN_PROPERTY = _o(
    "280", "Stolen Property Offenses", "Property", "Part II", "Stolen Property Offenses"
)
VAGRANCY = _o(
    "90B", "Curfew/Loitering/Vagrancy Violations", "Society", "Part II", "All Other Offenses"
)
DISORDERLY = _o("90C", "Disorderly Conduct", "Society", "Part II", "All Other Offenses")
DUI = _o("90D", "Driving Under the Influence", "Society", "Part II", "All Other Offenses")
TRESPASS = _o("90J", "Trespass of Real Property", "Property", "Part II", "All Other Offenses")
OTHER = _o("90Z", "All Other Offenses", "Society", "Part II", "All Other Offenses")
NO_OFFENSE = Offense("", "", "", "", "")

# The UCR category each record carries; it decides the offense unless the
# record's more specific type or code says otherwise.
CATEGORIES = {
    "HOMICIDE": HOMICIDE,
    "HOMIICIDE": HOMICIDE,
    "MANSLAUGHTER": NEGLIGENT,
    "RAPE": RAPE,
    "ROBBERY": ROBBERY,
    "ROBBERY-PEDESTRIAN": ROBBERY,
    "ROBBERY-COMMERCIAL": ROBBERY,
    "ROBBERY-RESIDENCE": ROBBERY,
    "AGG ASSAULT": AGG_ASSAULT,
    "BURGLARY": BURGLARY,
    "BURGLARY-RESIDENCE": BURGLARY,
    "BURGLARY-NONRES": BURGLARY,
    "AUTO THEFT": VEHICLE_THEFT,
    "LARCENY-FROM VEHICLE": FROM_VEHICLE,
    "LARCENY-NON VEHICLE": OTHER_LARCENY,
}

# 1997-2008: APD crime types whose wording says more than their category,
# checked in order.
TYPE_RULES: list[tuple[re.Pattern[str], Offense]] = [
    (re.compile(p), o)
    for p, o in [
        (r"NON-CRIMINAL", NO_OFFENSE),
        (r"NEGL MANSLAUG", NEGLIGENT),
        (r"SIMPLE ASLT", SIMPLE_ASSAULT),
        (r"TERRORISTIC", INTIMIDATION),
        (r"VAGRANCY", VAGRANCY),
        (r"DISORD", DISORDERLY),
        (r"^DUI", DUI),
        (r"TRESPASS", TRESPASS),
        (r"STLN PROP", STOLEN_PROPERTY),
        (r"FRAUDUL", FRAUD),
        (r"^MISC OFFENSE", OTHER),
        (r"COUNTERFEITING|FORGE", FORGERY),
        (r"PARTS FROM VEHICLE|VEH PARTS", PARTS),
        (r"SHOPLIFT", SHOPLIFTING),
        (r"POCKET", POCKET),
        (r"SUDDEN SNATCH", PURSE),
        (r"COIN", COIN),
        (r"FROM BUILDING", FROM_BUILDING),
        (r"ARTICLES FROM VEHICLE", FROM_VEHICLE),
        (r"THEFT OF AIRCRAFT", OTHER_LARCENY),
    ]
]

# "GUN/OTH WEP" means a gun or another weapon, so it does not count.
FIREARM_WORDS = re.compile(r"\bGUN\b(?!/)|FIREARM")
# Types that name the weapon, so no gun in the name means none was used.
WEAPON_WORDS = re.compile(r"GUN|FIREARM|KNIFE|STRONG|WEP|WEAPON|-OTHER$")
# Offenses whose type or code usually names the weapon; for these a generic
# one leaves the firearm question open.
ARMED_OFFENSES = frozenset({"09A", "09B", "11A", "120", "13A"})


def classify_type(category: str, crime_type: str) -> Offense:
    """1997-2008: NIBRS offense for a UCR category and APD crime type."""
    offense = CATEGORIES.get(category.upper(), NO_OFFENSE)
    for pattern, specific in TYPE_RULES:
        if pattern.search(crime_type.upper()):
            return specific
    return offense


def firearm_from_type(offense: Offense, crime_type: str) -> str:
    crime_type = crime_type.upper()
    if FIREARM_WORDS.search(crime_type):
        return "yes"
    if offense.code in ARMED_OFFENSES and not WEAPON_WORDS.search(crime_type):
        return ""
    return "no"


# --- dates ------------------------------------------------------------------


def local_date(ms: object, *, utc_midnight: bool) -> date | None:
    """A date-only field. The 1997-2008 layer stores Atlanta midnight; the
    2009-2020 layer stores the date at UTC midnight."""
    if ms is None:
        return None
    dt = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=int(ms))
    return dt.date() if utc_midnight else dt.astimezone(ATLANTA).date()


def local_stamp(day: date | None, hour: int, minute: int) -> str:
    if day is None:
        return ""
    when = datetime(day.year, day.month, day.day, hour, minute, tzinfo=ATLANTA)
    return when.isoformat(timespec="seconds")


def time_of_day(ms: object) -> tuple[int, int] | None:
    """1997-2008 times are stored as Atlanta wall-clock times on a dummy date."""
    if ms is None:
        return None
    dt = (datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=int(ms))).astimezone(ATLANTA)
    return dt.hour, dt.minute


def parse_text_date(text: str | None) -> date | None:
    """2009-2020: '9/3/2013'."""
    try:
        month, day, year = (int(x) for x in (text or "").split("/"))
        return date(year, month, day)
    except ValueError:
        return None


def parse_text_time(text: str | None) -> tuple[int, int] | None:
    """2009-2020: '13:30' (occasionally '1330')."""
    digits = (text or "").replace(":", "").strip()
    if not digits.isdigit() or len(digits) > 4:
        return None
    hour, minute = divmod(int(digits), 100)
    return (hour, minute) if hour < 24 and minute < 60 else None


def stamp(day: date | None, clock: tuple[int, int] | None) -> str:
    if day is None:
        return ""
    return local_stamp(day, *(clock or (0, 0))) if clock else day.isoformat()


# --- records ----------------------------------------------------------------


def clean(value: object) -> str:
    text = "" if value is None else str(value).strip()
    return "" if text.upper() == "NULL" else " ".join(text.split())


def zone_name(value: object) -> str:
    text = clean(value)
    return f"Zone {text}" if text in {"1", "2", "3", "4", "5", "6"} else ""


def source_fields(source: str, attrs: dict, field_types: dict[str, str]) -> Row:
    return {
        f"src_{name}": clean(
            format_value(attrs.get(name), field_types.get(name, "esriFieldTypeString"))
        )
        for name in KEPT_FIELDS[source]
    }


def convert_1997(attrs: dict, field_types: dict[str, str]) -> Row:
    category = clean(attrs.get("UC2literal"))
    crime_type = clean(attrs.get("Offense_Description"))
    offense = classify_type(category, crime_type)
    reported = local_date(attrs.get("Report_date1"), utc_midnight=False)
    started = time_of_day(attrs.get("Time_From"))
    ended = time_of_day(attrs.get("Time_To"))
    beat = clean(attrs.get("CJIS_beat"))
    return {
        "Source": "1997-2008",
        "IncidentNumber": clean(attrs.get("Incident__")),
        "ReportDate": reported.isoformat() if reported else "",
        "OccurredFromDate": stamp(local_date(attrs.get("Date_From1"), utc_midnight=False), started),
        "OccurredToDate": stamp(local_date(attrs.get("Date_To1"), utc_midnight=False), ended),
        "SourceCategory": category,
        "SourceOffense": crime_type,
        **offense_columns(offense),
        "FireArmInvolved": firearm_from_type(offense, crime_type),
        "StreetAddress": clean(attrs.get("Address")),
        "Longitude": coordinate(attrs.get("Longitude")),
        "Latitude": coordinate(attrs.get("Latitude")),
        "BEAT": "" if beat == "0" else beat,
        "Zone": zone_name(attrs.get("CJIS_zone")),
        "NPU": clean(attrs.get("NPU")),
        "NhoodName": clean(attrs.get("NHood")),
        **source_fields("1997-2008", attrs, field_types),
    }


def convert_2009(attrs: dict, field_types: dict[str, str]) -> Row:
    category = clean(attrs.get("Crime_Type"))
    code = clean(attrs.get("NIBRS_Code"))
    offense, firearm = classify_code(category, code)
    reported = local_date(attrs.get("Report_Date"), utc_midnight=True)
    location = clean(attrs.get("Location"))
    return {
        "Source": "2009-2020",
        "IncidentNumber": clean(attrs.get("Report_Number")),
        "ReportDate": reported.isoformat() if reported else "",
        "OccurredFromDate": stamp(
            parse_text_date(attrs.get("Occur_Date")), parse_text_time(attrs.get("Occur_Time"))
        ),
        "OccurredToDate": stamp(
            parse_text_date(attrs.get("Possible_Date")),
            parse_text_time(attrs.get("Possible_Time")),
        ),
        "SourceCategory": category,
        "SourceOffense": code,
        **offense_columns(offense),
        "FireArmInvolved": firearm,
        # "2900 PEACHTREE RD NW @PUBLIX - PEACHTREE": the address, then a place name.
        "StreetAddress": location.split("@")[0].strip(),
        "Longitude": coordinate(attrs.get("Longitude")),
        "Latitude": coordinate(attrs.get("Latitude")),
        "BEAT": "" if clean(attrs.get("Beat")) in ("", "0") else clean(attrs.get("Beat")),
        "Zone": zone_name(attrs.get("Zone")),
        "NPU": clean(attrs.get("NPU")),
        "NhoodName": clean(attrs.get("Neighborhood")),
        **source_fields("2009-2020", attrs, field_types),
    }


def offense_columns(offense: Offense) -> Row:
    return {
        "NibrsUcrCode": offense.code,
        "NIBRS_Offense": offense.name,
        "Crime_Against": offense.against,
        "Part": offense.part,
        "NIBRS_Bucket": offense.bucket,
    }


def coordinate(value: object) -> str:
    """Positions of 0 mean none was recorded."""
    if value in (None, 0, 0.0):
        return ""
    return repr(float(value))


# --- 2009-2020 codes ----------------------------------------------------------

# NCIC-style offense codes, as APD's COBRA system used them. The meanings were
# confirmed by joining 2009-2012 records, on incident number, to an APD export
# of the same years that spells out the crime type (e.g. 1204 is
# ROB-STREET-GUN, 1315K AGGR ASLT/BATTERY-KNIFE). A trailing "A" on burglary
# and vehicle-theft codes marks an attempt, which NIBRS files under the same
# offense. Codes not listed here (stray 2902, 9999, NULL...) fall back to the
# record's category.
LARCENY_CODES = {
    "2301": POCKET,
    "2302": PURSE,
    "2303": SHOPLIFTING,
    "2304": PARTS,
    "2305": FROM_VEHICLE,
    "2307": COIN,
    "2308": FROM_BUILDING,
}
# Robbery: 1201-1203 business, 1204-1206 street, 1207-1209 residence, each
# gun / other weapon / strongarm; 1211 bank and 1299 other carry the weapon as
# a letter (G gun, K knife, O other, S strongarm); 1212 is forcible
# purse-snatching.
ROBBERY_GUN = re.compile(r"^(1201|1204|1207)[A-Z]?$|^12(11|99)G$")
ROBBERY_UNARMED_OR_OTHER = re.compile(r"^(120[235689])[A-Z]?$|^12(11|99)[KOS]$|^1212$")
# Aggravated assault: 1314 gun, 1315 other weapon (K: knife).
ASSAULT_GUN = {"1314"}
ASSAULT_OTHER_WEAPON = {"1315", "1315K"}
# Homicide: 901/903/911 gun, 902/904/912 other weapon.
HOMICIDE_GUN = {"901", "903", "911", "0901", "0903", "0911"}
HOMICIDE_OTHER_WEAPON = {"902", "904", "912", "0902", "0904", "0912"}
# A few records already carry a NIBRS code.
NIBRS_CODES = {
    o.code: o
    for o in (HOMICIDE, ROBBERY, AGG_ASSAULT, BURGLARY, VEHICLE_THEFT)
    + tuple(LARCENY_CODES.values())
    + (OTHER_LARCENY,)
}


def classify_code(category: str, code: str) -> tuple[Offense, str]:
    """2009-2020: (NIBRS offense, firearm) for a UCR category and offense code."""
    offense = CATEGORIES.get(category.upper(), NO_OFFENSE)
    code = code.upper()
    if offense is OTHER_LARCENY or offense is FROM_VEHICLE:
        offense = LARCENY_CODES.get(code, NIBRS_CODES.get(code, offense))
        if not offense.code.startswith("23"):
            offense = CATEGORIES[category.upper()]
        return offense, "no"
    if offense is ROBBERY:
        if ROBBERY_GUN.match(code):
            return offense, "yes"
        return offense, "no" if ROBBERY_UNARMED_OR_OTHER.match(code) else ""
    if offense is AGG_ASSAULT:
        if code in ASSAULT_GUN:
            return offense, "yes"
        return offense, "no" if code in ASSAULT_OTHER_WEAPON else ""
    if offense is HOMICIDE:
        if code in HOMICIDE_GUN:
            return offense, "yes"
        return offense, "no" if code in HOMICIDE_OTHER_WEAPON else ""
    return offense, "no"


# --- loading ----------------------------------------------------------------

CONVERTERS = {"1997-2008": convert_1997, "2009-2020": convert_2009}


def fetch(layer: Layer) -> list[dict]:
    oid = layer.oid_field
    total = layer.count("1=1")
    rows: list[dict] = []
    low = 0
    while len(rows) < total:
        rows += layer.query_all(f"{oid} > {low} AND {oid} <= {low + SLICE}")
        low += SLICE
        print(f"  {len(rows)} / {total}", file=sys.stderr)
        if low > total * 4 + SLICE:  # object ids far sparser than expected
            raise RuntimeError(f"could not page through {layer.url} by {oid}")
    return rows


def sort_key(row: Row) -> tuple[str, ...]:
    return (row["ReportDate"], row["IncidentNumber"], row["NibrsUcrCode"], *row.values())


def write_dataset(rows: list[Row], data_dir: Path) -> dict[str, int]:
    """Write data/historical/ from converted rows; returns counts for the summary."""
    by_month: dict[str, list[Row]] = {}
    for row in rows:
        key = row["ReportDate"][:7] if row["ReportDate"] else "unusual-dates"
        by_month.setdefault(key, []).append(row)
    dataset_dir = data_dir / DATASET
    for stale in [*dataset_dir.glob("[0-9][0-9][0-9][0-9]/*.csv"), *dataset_dir.glob("*.csv")]:
        if stale.stem not in by_month:
            stale.unlink()
    for month, month_rows in by_month.items():
        month_rows.sort(key=sort_key)
        columns = COLUMNS + sorted({c for r in month_rows for c in r} - set(COLUMNS))
        path = (
            dataset_dir / f"{month}.csv"
            if month == "unusual-dates"
            else dataset_dir / month[:4] / f"{month}.csv"
        )
        write_csv(path, columns, month_rows)
    return {
        "rows": len(rows),
        "months": len(by_month),
        "unmapped": sum(1 for r in rows if not r["NibrsUcrCode"]),
    }


def load_historical(data_dir: Path, layers: dict[str, Layer] | None = None) -> dict[str, int]:
    layers = layers or {name: Layer(url) for name, url in LAYERS.items()}
    rows: list[Row] = []
    by_source: Counter[str] = Counter()
    duplicates = 0
    for name, layer in layers.items():
        print(f"Fetching {name} from {layer.url}", file=sys.stderr)
        types = layer.field_types
        convert = CONVERTERS[name]
        # Both layers repeat some records with every field identical; keep one.
        seen: set[tuple[tuple[str, object], ...]] = set()
        for attrs in fetch(layer):
            fingerprint = tuple(sorted((k, v) for k, v in attrs.items() if k not in DROPPED))
            if fingerprint in seen:
                duplicates += 1
                continue
            seen.add(fingerprint)
            rows.append(convert(attrs, types))
            by_source[name] += 1
    counts = write_dataset(rows, data_dir)
    return {**counts, "duplicates": duplicates, **{f"from {k}": n for k, n in by_source.items()}}
