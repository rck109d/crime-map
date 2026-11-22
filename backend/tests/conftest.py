from __future__ import annotations

import copy
import json
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest

from crimemap.arcgis import Layer

FIXTURES = Path(__file__).parent / "fixtures"
TS = r"TIMESTAMP '([^']+)'"


def _ms(literal: str) -> int:
    dt = datetime.strptime(literal, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
    return int(dt.timestamp() * 1000)


def _matcher(where: str):
    if m := re.fullmatch(rf"ReportDate >= {TS} AND ReportDate < {TS}", where):
        lo, hi = _ms(m[1]), _ms(m[2])
        return lambda r: r["ReportDate"] is not None and lo <= r["ReportDate"] < hi
    if m := re.fullmatch(rf"ReportDate IS NULL OR ReportDate < {TS} OR ReportDate >= {TS}", where):
        lo, hi = _ms(m[1]), _ms(m[2])
        return lambda r: r["ReportDate"] is None or r["ReportDate"] < lo or r["ReportDate"] >= hi
    raise AssertionError(f"fake server cannot parse where clause: {where}")


class FakeServer:
    """Imitates the FeatureServer endpoints the loader uses."""

    def __init__(self, records: list[dict], meta: dict):
        self.records = copy.deepcopy(records)
        self.meta = meta
        self.calls = 0
        self.on_page = None  # hook to simulate a republish mid-fetch

    def __call__(self, url: str, params: dict[str, str]) -> dict:
        self.calls += 1
        if not url.endswith("/query"):
            return self.meta
        match = _matcher(params["where"])
        hits = sorted((r for r in self.records if match(r)), key=lambda r: r["OBJECTID"])
        if params.get("returnCountOnly") == "true":
            return {"count": len(hits)}
        if self.on_page:
            self.on_page(self, int(params["resultOffset"]))
            hits = sorted((r for r in self.records if match(r)), key=lambda r: r["OBJECTID"])
        off, n = int(params["resultOffset"]), int(params["resultRecordCount"])
        page = hits[off : off + n]
        return {
            "features": [{"attributes": copy.deepcopy(r)} for r in page],
            "exceededTransferLimit": off + n < len(hits),
        }


@pytest.fixture
def records() -> list[dict]:
    return json.loads((FIXTURES / "records.json").read_text())


@pytest.fixture
def server(records) -> FakeServer:
    return FakeServer(records, json.loads((FIXTURES / "layer.json").read_text()))


@pytest.fixture
def layer(server) -> Layer:
    return Layer("https://example.invalid/FeatureServer/0", fetch=server)
