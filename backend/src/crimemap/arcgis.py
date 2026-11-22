"""Minimal client for the APD crime layer on ArcGIS Online (standard library only)."""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterator
from datetime import UTC, datetime

DEFAULT_LAYER_URL = (
    "https://services3.arcgis.com/Et5Qfajgiyosiw4d/arcgis/rest/services/"
    "OpenDataWebsite_Crime_view/FeatureServer/0"
)
USER_AGENT = "crimemap-archiver/0.2"

# Ranges with more records than this are split before paging, so a layer
# republish mid-fetch only forces a small chunk to be retried.
CHUNK_MAX_RECORDS = 10_000


class ArcGISError(RuntimeError):
    pass


def utc_literal(dt: datetime) -> str:
    """SQL timestamp literal; the layer's date fields are stored in UTC."""
    return "TIMESTAMP '" + dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S") + "'"


def range_where(start: datetime, end: datetime, field: str = "ReportDate") -> str:
    return f"{field} >= {utc_literal(start)} AND {field} < {utc_literal(end)}"


Fetcher = Callable[[str, dict[str, str]], dict]


def http_get_json(url: str, params: dict[str, str], *, attempts: int = 6) -> dict:
    full = url + "?" + urllib.parse.urlencode({**params, "f": "json"})
    delay = 2.0
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=90) as resp:
                body = json.load(resp)
            if "error" in body:
                # ArcGIS reports many failures (including overload) as HTTP 200.
                raise ArcGISError(f"ArcGIS error: {body['error']}")
            return body
        except (urllib.error.URLError, TimeoutError, ArcGISError, json.JSONDecodeError) as exc:
            if isinstance(exc, urllib.error.HTTPError) and exc.code < 500 and exc.code != 429:
                raise
            if attempt == attempts:
                raise
            print(f"  request failed ({exc}); retrying in {delay:.0f}s", file=sys.stderr)
            time.sleep(delay)
            delay *= 2
    raise AssertionError("unreachable")


class Layer:
    def __init__(self, url: str = DEFAULT_LAYER_URL, fetch: Fetcher = http_get_json):
        self.url = url.rstrip("/")
        self._fetch = fetch
        self._meta: dict | None = None

    @property
    def metadata(self) -> dict:
        if self._meta is None:
            self._meta = self._fetch(self.url, {})
        return self._meta

    @property
    def fields(self) -> list[dict]:
        return self.metadata["fields"]

    @property
    def field_types(self) -> dict[str, str]:
        return {f["name"]: f["type"] for f in self.fields}

    @property
    def page_size(self) -> int:
        return int(self.metadata.get("maxRecordCount", 1000))

    @property
    def oid_field(self) -> str:
        return self.metadata.get("objectIdField", "OBJECTID")

    def count(self, where: str) -> int:
        return int(
            self._fetch(self.url + "/query", {"where": where, "returnCountOnly": "true"})["count"]
        )

    def _pages(self, where: str) -> Iterator[list[dict]]:
        offset = 0
        while True:
            body = self._fetch(
                self.url + "/query",
                {
                    "where": where,
                    "outFields": "*",
                    "returnGeometry": "false",
                    "orderByFields": self.oid_field,
                    "resultOffset": str(offset),
                    "resultRecordCount": str(self.page_size),
                },
            )
            features = body.get("features", [])
            yield [f["attributes"] for f in features]
            if not features or not body.get("exceededTransferLimit"):
                return
            offset += len(features)

    def query_all(self, where: str, *, attempts: int = 4) -> list[dict]:
        """Every record matching `where`, checked against the server's count.

        The layer is republished regularly; if that happens while paging, the
        pages can overlap or skip records, so the result is re-fetched until the
        record count before, after, and in hand all agree.
        """
        oid = self.oid_field
        for attempt in range(1, attempts + 1):
            expected = self.count(where)
            if expected == 0:
                return []
            by_oid: dict[object, dict] = {}
            for page in self._pages(where):
                for attrs in page:
                    by_oid[attrs.get(oid)] = attrs
            after = self.count(where)
            if len(by_oid) == expected == after:
                return list(by_oid.values())
            print(
                f"  inconsistent fetch for [{where}]: expected {expected}, got {len(by_oid)}, "
                f"count now {after} (attempt {attempt}/{attempts})",
                file=sys.stderr,
            )
            time.sleep(5 * attempt)
        raise ArcGISError(f"could not get a consistent result for [{where}]")

    def query_range(self, start: datetime, end: datetime) -> list[dict]:
        """All records with ReportDate in [start, end), split into safe chunks."""
        where = range_where(start, end)
        n = self.count(where)
        if n == 0:
            return []
        if n > CHUNK_MAX_RECORDS and (end - start).total_seconds() > 86_400:
            mid = start + (end - start) / 2
            return self.query_range(start, mid) + self.query_range(mid, end)
        print(f"  {start:%Y-%m-%d %H:%M} to {end:%Y-%m-%d %H:%M}: {n} records", file=sys.stderr)
        return self.query_all(where)
