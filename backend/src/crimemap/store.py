"""The on-disk archive: one sorted CSV per Atlanta-local month of report dates.

Layout:  <dataset_dir>/YYYY/YYYY-MM.csv  and  <dataset_dir>/unusual-dates.csv
"""

from __future__ import annotations

import csv
import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from .records import UNUSUAL_PARTITION, Row, partition_for, report_datetime, sort_key

SOURCE_FILE = "source.json"


def partition_path(dataset_dir: Path, partition: str) -> Path:
    if partition == UNUSUAL_PARTITION:
        return dataset_dir / f"{UNUSUAL_PARTITION}.csv"
    return dataset_dir / partition[:4] / f"{partition}.csv"


def read_csv(path: Path) -> tuple[list[str], list[Row]]:
    with path.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        return list(reader.fieldnames or []), [dict(r) for r in reader]


def write_csv(path: Path, columns: list[str], rows: list[Row]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".csv.tmp")
    with tmp.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, lineterminator="\n", extrasaction="raise")
        writer.writeheader()
        for row in rows:
            writer.writerow({c: row.get(c, "") for c in columns})
    tmp.replace(path)


@dataclass
class Archive:
    dataset_dir: Path
    columns: list[str] = field(default_factory=list)
    partitions: dict[str, list[Row]] = field(default_factory=dict)
    _on_disk: dict[str, tuple[list[str], list[Row]]] = field(default_factory=dict)

    @classmethod
    def load(cls, dataset_dir: Path) -> Archive:
        archive = cls(dataset_dir)
        if not dataset_dir.exists():
            return archive
        for path in sorted(dataset_dir.rglob("*.csv")):
            cols, rows = read_csv(path)
            part = path.stem
            archive._on_disk[part] = (cols, rows)
            archive.partitions[part] = list(rows)
            for c in cols:
                if c not in archive.columns:
                    archive.columns.append(c)
        return archive

    def all_rows(self) -> list[Row]:
        return [r for rows in self.partitions.values() for r in rows]

    def set_columns(self, source_columns: list[str]) -> None:
        """Source field order first; keep any retired columns at the end."""
        self.columns = source_columns + [c for c in self.columns if c not in source_columns]

    def replace_all(self, fresh: list[Row], now: datetime) -> None:
        self.partitions = {}
        for row in fresh:
            self.partitions.setdefault(partition_for(row, now), []).append(row)

    def replace_window(
        self, fresh: list[Row], start: datetime, end: datetime, now: datetime
    ) -> None:
        """Make the archive match `fresh` for report dates in [start, end).

        Archived rows in the window are replaced, since the source removes
        duplicates and reclassifies recent records. Rows outside the window are
        never touched: incident numbers are occasionally reused, so a matching
        key elsewhere is not proof of a stale copy, and older history should
        only change through an explicit full reload.
        """
        kept = []
        for row in self.all_rows():
            dt = report_datetime(row)
            if dt is not None and start <= dt < end:
                continue
            kept.append(row)
        self.replace_all(kept + fresh, now)

    def rows_in_window(self, start: datetime, end: datetime) -> int:
        n = 0
        for row in self.all_rows():
            dt = report_datetime(row)
            if dt is not None and start <= dt < end:
                n += 1
        return n

    def save(self) -> dict[str, tuple[int, int]]:
        """Write changed partitions; return {partition: (added, removed)}."""
        changes: dict[str, tuple[int, int]] = {}
        for part in sorted(set(self.partitions) | set(self._on_disk)):
            rows = sorted(self.partitions.get(part, []), key=lambda r: sort_key(r, self.columns))
            old_cols, old_rows = self._on_disk.get(part, ([], []))
            path = partition_path(self.dataset_dir, part)
            if not rows:
                if path.exists():
                    path.unlink()
                    if path.parent != self.dataset_dir and not any(path.parent.iterdir()):
                        path.parent.rmdir()
                if old_rows:
                    changes[part] = (0, len(old_rows))
                continue
            new_t = [_freeze(r, self.columns) for r in rows]
            old_t = [_freeze(r, self.columns) for r in old_rows]
            if old_cols == self.columns and old_t == new_t:
                continue
            new_c, old_c = Counter(new_t), Counter(old_t)
            write_csv(path, self.columns, rows)
            changes[part] = (sum((new_c - old_c).values()), sum((old_c - new_c).values()))
            self._on_disk[part] = (list(self.columns), rows)
        return changes


def _freeze(row: Row, columns: list[str]) -> tuple[str, ...]:
    return tuple(row.get(c, "") for c in columns)


def write_source_snapshot(dataset_dir: Path, layer_url: str, fields: list[dict]) -> None:
    """Record the source's schema so field changes show up in git history."""
    snapshot = {
        "layer_url": layer_url,
        "fields": [{k: f.get(k) for k in ("name", "type", "alias", "length")} for f in fields],
    }
    path = dataset_dir / SOURCE_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(snapshot, indent=2) + "\n"
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")
