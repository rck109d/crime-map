"""The change log: rows that left the archive, kept so APD's edits can be studied.

The archive mirrors APD's layer, so when APD removes or edits a record the
archived row is replaced. Each row that is replaced or dropped is first
appended here, under `data/nibrs-changes/`, with what happened to it:

    removed            the incident is no longer in the source at all
    offense_removed    the incident remains, but without this offense
                       (typically a reclassification to another offense)
    duplicate_removed  an identical row is still in the source
    changed            same incident and offense, different field values;
                       `new_values` holds the fields that changed

The log is append-only and is never read by the loader, so nothing in it can
affect the archive itself.
"""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime
from pathlib import Path

from .records import KEY_FIELDS, Row, row_key, sort_key
from .store import read_csv, write_csv

DATASET = "nibrs-changes"
META_COLUMNS = ["observed_at", "change", "new_values"]
# GitHub rejects files over 100 MB. A mass edit by APD could log every archived
# row at once, so a month's log rolls over into numbered parts well before that.
MAX_ROWS_PER_FILE = 150_000

Entry = tuple[str, Row, dict[str, str]]


def diff_rows(dropped: list[Row], fresh: list[Row], columns: list[str]) -> list[Entry]:
    """Classify each dropped row that has no identical counterpart in `fresh`.

    Rows are compared on `columns` only (the columns the old and new data have
    in common), so APD adding or retiring a column does not count as an edit
    to every record.
    """
    if not columns:
        return []

    def freeze(row: Row) -> tuple[str, ...]:
        return tuple(row.get(c, "") for c in columns)

    fresh_counts = Counter(freeze(r) for r in fresh)
    unmatched = Counter(fresh_counts)
    gone: list[Row] = []
    for row in dropped:
        frozen = freeze(row)
        if unmatched[frozen] > 0:
            unmatched[frozen] -= 1
        else:
            gone.append(row)
    if not gone:
        return []

    # Fresh rows with no identical archived row: candidates for "the new version of".
    appeared: dict[tuple[str, ...], list[Row]] = {}
    for row in sorted(fresh, key=lambda r: sort_key(r, columns)):
        frozen = freeze(row)
        if unmatched[frozen] > 0:
            unmatched[frozen] -= 1
            appeared.setdefault(row_key(row), []).append(row)

    incident_field = KEY_FIELDS[0]
    incidents = {r.get(incident_field, "") for r in fresh}
    entries: list[Entry] = []
    for row in sorted(gone, key=lambda r: sort_key(r, columns)):
        successors = appeared.get(row_key(row))
        if fresh_counts[freeze(row)] > 0:
            entries.append(("duplicate_removed", row, {}))
        elif successors:
            new = successors.pop(0)
            changed = {c: new.get(c, "") for c in columns if new.get(c, "") != row.get(c, "")}
            entries.append(("changed", row, changed))
        elif row.get(incident_field, "") in incidents:
            entries.append(("offense_removed", row, {}))
        else:
            entries.append(("removed", row, {}))
    return entries


def _part_path(directory: Path, month: str, part: int) -> Path:
    name = f"{month}.csv" if part == 1 else f"{month}.part{part}.csv"
    return directory / month[:4] / name


def append_changes(directory: Path, entries: list[Entry], columns: list[str], now: datetime) -> int:
    """Append entries to the log for the month in which they were observed."""
    if not entries:
        return 0
    observed = now.isoformat(timespec="seconds")
    rows: list[Row] = []
    for change, row, new_values in entries:
        logged = {
            "observed_at": observed,
            "change": change,
            "new_values": json.dumps(new_values, sort_keys=True, ensure_ascii=False)
            if new_values
            else "",
        }
        logged.update({c: row.get(c, "") for c in columns})
        rows.append(logged)

    month = now.strftime("%Y-%m")
    part = 1
    while _part_path(directory, month, part + 1).exists():
        part += 1
    while rows:
        path = _part_path(directory, month, part)
        header, existing = read_csv(path) if path.exists() else ([], [])
        room = MAX_ROWS_PER_FILE - len(existing)
        if room <= 0:
            part += 1
            continue
        wanted = [*META_COLUMNS, *columns]
        # Keep columns an earlier entry was written with, should the schema have changed.
        header = wanted + [c for c in header if c not in wanted]
        write_csv(path, header, existing + rows[:room])
        rows = rows[room:]
        part += 1
    return len(entries)
