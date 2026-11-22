"""Turn ArcGIS feature attributes into the archive's plain-text row format.

Every value in the archive is a string, so rows read back from CSV and rows
freshly fetched from the source compare equal when nothing has changed.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

ATLANTA = ZoneInfo("America/New_York")

# OBJECTID is assigned by ArcGIS and changes whenever APD republishes the layer,
# so storing it would make every refresh look like a full rewrite.
DROPPED_FIELDS = frozenset({"OBJECTID"})

# A row is one offense within one incident: IncidentNumber repeats when an
# incident has several offenses. (IncidentNumber, NibrsUcrCode) is nearly unique
# but not quite (numbers are occasionally reused, and the source has a few exact
# duplicate rows), so it is used only for ordering, never to delete records.
KEY_FIELDS = ("IncidentNumber", "NibrsUcrCode")

DATE_FIELD = "ReportDate"

# Report dates outside this range are data-entry errors in the source (there are
# records dated in the years 1015 and 2124). They are kept, in their own file.
SANE_EARLIEST = datetime(1980, 1, 1, tzinfo=ATLANTA)
UNUSUAL_PARTITION = "unusual-dates"

Row = dict[str, str]


def format_value(value: object, esri_type: str) -> str:
    if value is None:
        return ""
    if esri_type == "esriFieldTypeDate":
        return epoch_ms_to_iso(int(value))
    if esri_type == "esriFieldTypeDouble" or esri_type == "esriFieldTypeSingle":
        return repr(float(value))
    if esri_type in (
        "esriFieldTypeInteger",
        "esriFieldTypeSmallInteger",
        "esriFieldTypeBigInteger",
    ):
        return str(int(value))
    return str(value)


def epoch_ms_to_iso(ms: int) -> str:
    """Epoch milliseconds (UTC) -> Atlanta local time with its UTC offset."""
    dt = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(milliseconds=ms)
    return dt.astimezone(ATLANTA).isoformat(timespec="seconds")


def normalize(attributes: dict[str, object], field_types: dict[str, str]) -> Row:
    row: Row = {}
    for name, value in attributes.items():
        if name in DROPPED_FIELDS:
            continue
        row[name] = format_value(value, field_types.get(name, "esriFieldTypeString"))
    return row


def row_key(row: Row) -> tuple[str, ...]:
    return tuple(row.get(f, "") for f in KEY_FIELDS)


def report_datetime(row: Row) -> datetime | None:
    value = row.get(DATE_FIELD, "")
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def partition_for(row: Row, now: datetime) -> str:
    """Archive file a row belongs in: 'YYYY-MM' by Atlanta-local report date."""
    dt = report_datetime(row)
    if dt is None or dt < SANE_EARLIEST or dt > now + timedelta(days=2):
        return UNUSUAL_PARTITION
    return dt.astimezone(ATLANTA).strftime("%Y-%m")


def sort_key(row: Row, columns: list[str]) -> tuple[str, ...]:
    return (row.get(DATE_FIELD, ""), *row_key(row), *(row.get(c, "") for c in columns))
