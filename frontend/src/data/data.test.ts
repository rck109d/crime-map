import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dateTicks, formatMinute, formatRange, makeCalendar } from "./dates";
import { coverageMask, coverageSpans, gaps, overlaps } from "./coverage";
import { toCsv, toKml, type ExportRow } from "./export";
import { HIDDEN, incidentsByAddress, nearby, rowsAtAddress, summarize, visibleBounds, type Filters } from "./filter";
import { combineYears, decodePoints, isGzip, locate, lowerBoundDay } from "./format";
import { makeGeo, pointInRing } from "./geo";
import { binHex, classOf, hexAt, hexBreaks, hexRing, rowsInHex } from "./hexbin";
import { groupByIncident, incidentRun } from "./incidents";
import { nominatimUrl, parseNominatim, parsePhoton, photonUrl } from "./places";
import { convexHull } from "./hull";
import { displayName, searchAreas, searchPlaces, streetFilter, tokenize, type SearchIndex } from "./search";
import { gaussianSmooth, niceTicks } from "./smooth";
import {
  FLAG_FAMILY,
  FLAG_FIREARM,
  FLAG_PART1,
  GROUP_COUNT,
  NO_COORD,
  UNKNOWN,
  type Manifest,
  type PointColumns,
} from "./types";

/** rows: [day, x, y, offense, nhood, npu, zone, flags, occHour, occDow, address id (optional)] */
function table(rows: number[][]): PointColumns {
  const n = rows.length;
  const col = (k: number) => rows.map((r) => r[k]);
  return {
    count: n,
    day: Uint16Array.from(col(0)),
    minute: new Uint16Array(n),
    x: Uint16Array.from(col(1)),
    y: Uint16Array.from(col(2)),
    offense: Uint8Array.from(col(3)),
    nhood: Uint16Array.from(col(4)),
    npu: Uint8Array.from(col(5)),
    zone: Uint8Array.from(col(6)),
    flags: Uint8Array.from(col(7)),
    occHour: Uint8Array.from(col(8)),
    occDow: Uint8Array.from(col(9)),
    addrLo: Uint16Array.from(col(10).map((id) => (id ?? 0) & 0xffff)),
    addrHi: Uint8Array.from(col(10).map((id) => (id ?? 0) >> 16)),
  };
}

function encode(cols: PointColumns): ArrayBuffer {
  const n = cols.count;
  const buf = new ArrayBuffer(12 + n * 19);
  const view = new DataView(buf);
  [0x43, 0x4d, 0x41, 0x50].forEach((b, i) => view.setUint8(i, b));
  view.setUint16(4, 3, true);
  view.setUint32(8, n, true);
  let o = 12;
  for (const c of [cols.day, cols.minute, cols.x, cols.y, cols.nhood, cols.addrLo]) {
    for (let i = 0; i < n; i++, o += 2) view.setUint16(o, c[i], true);
  }
  for (const c of [cols.offense, cols.npu, cols.zone, cols.flags, cols.occHour, cols.occDow, cols.addrHi]) {
    for (let i = 0; i < n; i++, o++) view.setUint8(o, c[i]);
  }
  return buf;
}

const manifest: Manifest = {
  version: 1,
  build: "test",
  epoch: "2021-01-01",
  through: "2022-01-03",
  count: 6,
  unmapped: 1,
  bbox: { west: -84.75, south: 33.5, east: -84.15, north: 34.0 },
  coordSteps: 65534,
  groups: ["Person", "Property", "Society", "Unclassified"],
  offenses: [
    { name: "Simple Assault", code: "13B", bucket: "Assault Offenses", group: 0, part1: false },
    { name: "Shoplifting", code: "23C", bucket: "Shoplifting", group: 1, part1: true },
    { name: "Unclassified", code: "NOT_APPL", bucket: "Unclassified", group: 3, part1: false },
  ],
  nhoods: ["", "Midtown", "Downtown"],
  npus: ["", "E", "M"],
  zones: ["", "Zone 5"],
  locationTypes: [""],
  years: [
    { year: 2021, count: 4, months: [{ month: "2021-01", count: 3 }, { month: "2021-02", count: 1 }] },
    { year: 2022, count: 2, months: [{ month: "2022-01", count: 2 }] },
  ],
};
const y2021 = table([
  [0, 100, 100, 0, 1, 1, 1, 3, 13, 5, 70000],
  [0, 100, 100, 1, 1, 1, 1, 4, 0, 5, 7],
  [3, 5000, 5000, 1, 2, 2, 1, 4, UNKNOWN, UNKNOWN],
  [40, NO_COORD, NO_COORD, 2, 0, 0, 0, 0, 9, 1],
]);
const y2022 = table([
  [366, 120, 110, 0, 1, 1, 1, 0, 22, 0, 70000],
  [367, 9000, 9000, 1, 2, 2, 1, 5, 23, 0],
]);
const sizes = { offenses: 3, nhoods: 3, npus: 3, zones: 2 };
const all: Filters = {
  d0: 0,
  d1: 400,
  groups: [true, true, true, true],
  offenses: null,
  area: null,
  polygon: null,
  requireFlags: 0,
};
const points = combineYears(manifest, new Map([[2022, y2022], [2021, y2021]]));

describe("points format", () => {
  it("round-trips a table through the binary layout", () => {
    const decoded = decodePoints(encode(y2021));
    expect(decoded.count).toBe(4);
    expect([...decoded.day]).toEqual([0, 0, 3, 40]);
    expect([...decoded.x]).toEqual([100, 100, 5000, NO_COORD]);
    expect([...decoded.occHour]).toEqual([13, 0, UNKNOWN, 9]);
  });

  it("rejects files that are not points tables", () => {
    expect(() => decodePoints(new ArrayBuffer(20))).toThrow(/not a crime-map/);
    expect(() => decodePoints(encode(y2021).slice(0, 30))).toThrow(/bytes/);
  });

  it("joins years in order and derives groups and month segments", () => {
    expect(points.count).toBe(6);
    expect([...points.day]).toEqual([0, 0, 3, 40, 366, 367]);
    expect([...points.group]).toEqual([0, 1, 1, 3, 0, 1]);
    expect([...points.address]).toEqual([70000, 7, 0, 0, 70000, 0]); // ids above 65,535 survive
    expect(locate(points, 2)).toEqual({ month: "2021-01", row: 2 });
    expect(locate(points, 3)).toEqual({ month: "2021-02", row: 0 });
    expect(locate(points, 5)).toEqual({ month: "2022-01", row: 1 });
    expect(locate(points, 6)).toBeNull();
    expect(lowerBoundDay(points.day, 1)).toBe(2);
    expect(lowerBoundDay(points.day, 500)).toBe(6);
  });

  const built = new URL("../../public/data/manifest.json", import.meta.url);
  it.skipIf(!existsSync(built))("decodes what the Python builder wrote", () => {
    const real: Manifest = JSON.parse(readFileSync(built, "utf8"));
    let total = 0;
    for (const year of real.years) {
      const raw = readFileSync(new URL(`points-${year.year}.bin`, built));
      expect(isGzip(raw)).toBe(true);
      const bytes = gunzipSync(raw);
      const cols = decodePoints(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
      expect(cols.count).toBe(year.count);
      expect(year.months.reduce((n, m) => n + m.count, 0)).toBe(year.count);
      for (let i = 1; i < cols.count; i++) expect(cols.day[i]).toBeGreaterThanOrEqual(cols.day[i - 1]);
      expect(Math.max(...cols.offense)).toBeLessThan(real.offenses.length);
      const cal = makeCalendar(real.epoch);
      expect(cal.year(cols.day[0])).toBe(year.year);
      expect(cal.year(cols.day[cols.count - 1])).toBe(year.year);
      const month = year.months[0];
      const detail = JSON.parse(readFileSync(new URL(`detail/${month.month}.json`, built), "utf8"));
      expect(detail.inc.length).toBe(month.count);
      if (detail.type) expect(detail.type.length).toBe(month.count);
      total += cols.count;
    }
    expect(total).toBe(real.count);
  });
});

describe("summarize", () => {
  it("counts everything with no filters", () => {
    const s = summarize(points, all, sizes);
    expect(s.total).toBe(6);
    expect(s.mapped).toBe(5);
    expect(s.firearm).toBe(2);
    expect(s.familyViolence).toBe(1);
    expect([...s.byGroup]).toEqual([2, 3, 0, 1]);
    expect([...s.byOffense]).toEqual([2, 3, 1]);
    expect([...s.byArea.nhood]).toEqual([1, 3, 2]);
    expect(s.hourDow[5 * 24 + 13]).toBe(1);
    expect(s.hourDow.reduce((a, b) => a + b)).toBe(5);
    expect(s.daily[3 * GROUP_COUNT + 1]).toBe(1);
  });

  it("limits to the inclusive date range", () => {
    const s = summarize(points, { ...all, d0: 3, d1: 366 }, sizes);
    expect([s.i0, s.i1, s.total]).toEqual([2, 5, 3]);
    expect([...s.style]).toEqual([255, 255, 1, 3, 0, 255]);
    expect(s.daily.length).toBe(364 * GROUP_COUNT);
  });

  it("keeps a switched-off group countable but hidden", () => {
    const s = summarize(points, { ...all, groups: [true, false, true, true] }, sizes);
    expect(s.total).toBe(3);
    expect([...s.byGroup]).toEqual([2, 3, 0, 1]);
    expect([...s.byArea.nhood]).toEqual([1, 2, 0]);
  });

  it("applies offense, area, firearm and drawn-area filters together", () => {
    expect(summarize(points, { ...all, offenses: new Set([1]) }, sizes).total).toBe(3);
    const area = summarize(points, { ...all, area: { kind: "nhood", id: 1 } }, sizes);
    expect(area.total).toBe(3);
    expect([...area.byArea.nhood]).toEqual([1, 3, 2]); // other areas stay listed
    expect([...area.byOffense]).toEqual([2, 1, 0]);
    expect(summarize(points, { ...all, requireFlags: FLAG_FIREARM }, sizes).total).toBe(2);
    expect(summarize(points, { ...all, requireFlags: FLAG_FAMILY }, sizes).total).toBe(1);
    // Part I only: one switch narrows every count, including the per-offense ones.
    const part1 = summarize(points, { ...all, requireFlags: FLAG_PART1 }, sizes);
    expect(part1.total).toBe(3);
    expect([...part1.byOffense]).toEqual([0, 3, 0]);
    expect(summarize(points, { ...all, requireFlags: FLAG_PART1 | FLAG_FIREARM }, sizes).total).toBe(1);
    const ring = [[50, 50], [200, 50], [200, 200], [50, 200]] as const;
    const drawn = summarize(points, { ...all, polygon: ring }, sizes);
    expect(drawn.total).toBe(3); // the unmapped row can never be inside
    expect(visibleBounds(points, drawn)).toEqual({ minX: 100, maxX: 120, minY: 100, maxY: 110 });
  });

  it("gathers an address's rows by id, wherever they are mapped, newest first", () => {
    const s = summarize(points, all, sizes);
    expect(rowsAtAddress(points, s, 70000)).toEqual([4, 0]); // rows 0 and 4 sit at different positions
    expect(rowsAtAddress(points, s, 7)).toEqual([1]);
    expect(rowsAtAddress(points, s, 0)).toEqual([]); // 0 means no address, never a match
    const recent = summarize(points, { ...all, d0: 300 }, sizes);
    expect(rowsAtAddress(points, recent, 70000)).toEqual([4]);
  });

  it("finds rows near a tap, nearest spot first and newest first within it", () => {
    const s = summarize(points, all, sizes);
    expect(nearby(points, s, 101, 101, 30, 30)).toEqual([1, 0, 4]);
    expect(nearby(points, s, 20000, 20000, 30, 30)).toEqual([]);
  });
});

describe("geometry", () => {
  const geo = makeGeo(manifest);
  it("converts quantized coordinates both ways", () => {
    expect(geo.lng(0)).toBeCloseTo(-84.75, 9);
    expect(geo.lat(65534)).toBeCloseTo(34.0, 9);
    expect(geo.x(geo.lng(1234))).toBeCloseTo(1234, 6);
    expect(geo.mPerX).toBeGreaterThan(0.8);
    expect(geo.mPerX).toBeLessThan(0.9);
  });
  it("tests points against a ring", () => {
    const ring = [[0, 0], [10, 0], [10, 10], [0, 10]] as const;
    expect(pointInRing(5, 5, ring)).toBe(true);
    expect(pointInRing(15, 5, ring)).toBe(false);
  });
  it("bins points into hexagons consistently", () => {
    const s = summarize(points, all, sizes);
    const cells = binHex(points, s, geo, 200);
    expect(cells.reduce((n, c) => n + c.count, 0)).toBe(5);
    const top = cells.reduce((a, b) => (b.count > a.count ? b : a));
    expect(top.count).toBe(3);
    expect(rowsInHex(points, s, geo, 200, top.q, top.r)).toEqual([4, 1, 0]);
    // Every corner of a cell's ring is within one radius of its centre.
    const ring = hexRing(top.q, top.r, 200, geo, 1);
    expect(ring).toHaveLength(7);
    const [q, r] = hexAt(geo.x((ring[0][0] + ring[3][0]) / 2) * geo.mPerX, geo.y((ring[0][1] + ring[3][1]) / 2) * geo.mPerY, 200);
    expect([q, r]).toEqual([top.q, top.r]);
  });
  it("builds increasing class breaks", () => {
    expect(hexBreaks(100, 5)).toEqual([4, 16, 36, 64, 100]);
    expect(hexBreaks(2, 5)).toEqual([1, 2]);
    expect(classOf(1, [4, 16, 36])).toBe(0);
    expect(classOf(17, [4, 16, 36])).toBe(2);
    expect(classOf(99, [4, 16, 36])).toBe(2);
  });
});

describe("smoothing", () => {
  it("leaves a constant series unchanged, including at the ends", () => {
    for (const v of gaussianSmooth([4, 4, 4, 4, 4, 4], 2)) expect(v).toBeCloseTo(4, 12);
  });
  it("spreads a spike without changing its neighbourhood total much", () => {
    const out = gaussianSmooth([0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0], 1);
    expect(out[5]).toBeLessThan(10);
    expect(out[5]).toBeGreaterThan(out[4]);
    expect(out[4]).toBeCloseTo(out[6], 12);
    expect(out.reduce((a, b) => a + b)).toBeCloseTo(10, 1);
  });
  it("returns the input when the radius is zero", () => {
    expect([...gaussianSmooth([1, 2, 3], 0)]).toEqual([1, 2, 3]);
  });
  it("skips days with no data instead of averaging them in as zero", () => {
    const covered = [1, 1, 1, 0, 0, 1, 1, 1];
    const out = gaussianSmooth([4, 4, 4, 0, 0, 4, 4, 4], 2, covered);
    expect(Number.isNaN(out[3]) && Number.isNaN(out[4])).toBe(true);
    for (const i of [0, 1, 2, 5, 6, 7]) expect(out[i]).toBeCloseTo(4, 12);
    expect([...gaussianSmooth([1, 2, 3], 0, [1, 0, 1])]).toEqual([1, NaN, 3]);
  });
  it("picks round axis ticks", () => {
    expect(niceTicks(87)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("coverage", () => {
  const cal = makeCalendar("2004-01-01");
  const spans = coverageSpans(
    {
      epoch: "2004-01-01",
      through: "2021-01-10",
      coverage: [
        { source: "historical", from: "2004-01-01", to: "2004-01-05" },
        { source: "nibrs", from: "2004-01-09", to: "2004-01-10" },
      ],
    } as Manifest,
    cal,
  );
  it("turns the manifest's date spans into day indexes", () => {
    expect(spans).toEqual([
      { source: "historical", d0: 0, d1: 4 },
      { source: "nibrs", d0: 8, d1: 9 },
    ]);
  });
  it("marks the days of a range that have data", () => {
    expect([...coverageMask(spans, 3, 10)]).toEqual([1, 1, 0, 0, 0, 1, 1, 0]);
  });
  it("lists the gaps inside a range, including after the last span", () => {
    expect(gaps(spans, 0, 9)).toEqual([{ d0: 5, d1: 7 }]);
    expect(gaps(spans, 6, 12)).toEqual([
      { d0: 6, d1: 7 },
      { d0: 10, d1: 12 },
    ]);
    expect(gaps(spans, 8, 9)).toEqual([]);
  });
  it("tells whether a range reaches a dataset", () => {
    expect(overlaps(spans, "historical", 4, 20)).toBe(true);
    expect(overlaps(spans, "historical", 5, 20)).toBe(false);
  });
  it("treats an older manifest without coverage as one span", () => {
    const old = coverageSpans({ epoch: "2004-01-01", through: "2004-01-31" } as Manifest, cal);
    expect(old).toEqual([{ source: "nibrs", d0: 0, d1: 30 }]);
  });
});

describe("export", () => {
  const row: ExportRow = {
    incident: "262821556",
    reportNumber: "262821556-1",
    reported: "2026-10-10 18:22",
    occurredFrom: "2026-10-10 17:00",
    occurredTo: "",
    offense: 'Theft <"quoted">, & more',
    category: "Property",
    firearm: false,
    familyViolence: true,
    partI: true,
    victims: "2",
    address: "=HYPERLINK(1)",
    locationType: "Residence home",
    neighborhood: "Midtown",
    npu: "E",
    zone: "Zone 5",
    beat: "505",
    longitude: -84.38,
    latitude: 33.78,
  };
  it("writes CSV with quoting and formula protection", () => {
    const [header, line] = toCsv([row]).trimEnd().split("\n");
    expect(header.split(",")).toHaveLength(19);
    expect(line.startsWith("262821556,262821556-1,")).toBe(true);
    expect(line).toContain(",Property,no,yes,yes,2,");
    expect(line).toContain('"Theft <""quoted"">, & more"');
    expect(line).toContain(",'=HYPERLINK(1),");
    expect(line.endsWith("-84.38,33.78")).toBe(true);
  });
  it("writes KML with escaped text and skips unmapped rows", () => {
    const kml = toKml([row, { ...row, longitude: null, latitude: null }], "Test & export");
    expect(kml.match(/<Placemark>/g)).toHaveLength(1);
    expect(kml).toContain("<name>Test &#38; export</name>");
    expect(kml).toContain("<coordinates>-84.38,33.78,0</coordinates>");
    expect(kml).not.toContain('<"quoted">');
  });
});

describe("incident grouping", () => {
  // Rows 1-2 continue row 0 (one report, three offenses); row 5 continues row 4.
  const flags = Uint8Array.from([0, 8, 8 | 1, 0, 2, 8, 0]);
  it("finds the whole incident from any of its rows", () => {
    expect(incidentRun(flags, 0)).toEqual({ start: 0, end: 3 });
    expect(incidentRun(flags, 2)).toEqual({ start: 0, end: 3 });
    expect(incidentRun(flags, 3)).toEqual({ start: 3, end: 4 });
    expect(incidentRun(flags, 5)).toEqual({ start: 4, end: 6 });
    expect(incidentRun(flags, 6)).toEqual({ start: 6, end: 7 });
  });
  it("lists each incident once, in the order first met", () => {
    expect(groupByIncident(flags, [5, 2, 1, 6, 4, 0])).toEqual([
      { start: 4, end: 6 },
      { start: 0, end: 3 },
      { start: 6, end: 7 },
    ]);
    expect(groupByIncident(flags, [])).toEqual([]);
  });
});

describe("calendar", () => {
  it("maps day indexes to dates", () => {
    const cal = makeCalendar("2021-01-01");
    expect(cal.iso(0)).toBe("2021-01-01");
    expect(cal.iso(366)).toBe("2022-01-02");
    expect(cal.dayOf("2024-02-29")).toBe(1154);
    expect(cal.iso(cal.dayOf("2026-11-22"))).toBe("2026-11-22");
  });
  it("formats ranges and times", () => {
    const cal = makeCalendar("2021-01-01");
    expect(formatRange(cal.date(0), cal.date(30))).toBe("Jan 1 – Jan 31, 2021");
    expect(formatRange(cal.date(360), cal.date(370))).toBe("Dec 27, 2021 – Jan 6, 2022");
    expect(formatRange(cal.date(5), cal.date(5))).toBe("Jan 6, 2021");
    expect(formatMinute(0)).toBe("12:00 AM");
    expect(formatMinute(13 * 60 + 5)).toBe("1:05 PM");
  });
  it("chooses axis ticks that fit the span", () => {
    const cal = makeCalendar("2021-01-01");
    const week = dateTicks(0, 7, cal, 4);
    expect(week.map((t) => t.label)).toEqual(["Jan 1", "Jan 3", "Jan 5", "Jan 7"]);
    const quarter = dateTicks(cal.dayOf("2026-08-25"), 90, cal, 4);
    expect(quarter.map((t) => t.label)).toEqual(["Sep", "Oct", "Nov"]);
    const years = dateTicks(0, cal.dayOf("2026-11-22") + 1, cal, 5);
    expect(years.map((t) => t.label)).toEqual(["2022", "2024", "2026"]);
    const twoYears = dateTicks(cal.dayOf("2025-01-01"), 690, cal, 5);
    expect(twoYears.map((t) => t.label)).toEqual(["Jan ’25", "Jul", "Jan ’26", "Jul"]);
    for (const set of [week, quarter, years, twoYears]) expect(set.length).toBeLessThanOrEqual(5);
  });
});

describe("search", () => {
  const index: SearchIndex = {
    streets: [
      { n: "PEACHTREE RD NE", c: 50, a: [25, 10, 10, 1, 4, 3393, 20, 30, 40, 1, 3395, 21, 31, 9, 3] },
      { n: "PEACHTREE ST NE", c: 30, a: [1052, 40, 50, 30, 2] },
      { n: "10TH ST NE", c: 12, a: [33, 60, 70, 12, 5] },
      { n: "W PEACHTREE ST NW", c: 8, a: [339, 80, 90, 8, 6] },
    ],
    crossings: [
      ["PEACHTREE ST NE / 10TH ST NE", 45, 55, 6, 7],
      ["PRYOR ST / BASS ST", 5, 5, 2, 8],
    ],
  };
  const areas = { nhoods: ["", "Midtown", "Peachtree Hills", "Downtown"], npus: ["", "E", "M"], zones: ["", "Zone 5"] };

  it("tokenizes with abbreviations and without filler", () => {
    expect(tokenize(" 3393  Peachtree Road, northeast ")).toEqual(["3393", "PEACHTREE", "RD", "NE"]);
    expect(tokenize("peachtree & 10th")).toEqual(["PEACHTREE", "10TH"]);
    expect(tokenize("   ")).toEqual([]);
  });

  it("finds streets by word prefixes, names that start with the query first", () => {
    const { streets } = searchPlaces(index, "peach");
    expect(streets.map((h) => h.label)).toEqual(["PEACHTREE RD NE", "PEACHTREE ST NE", "W PEACHTREE ST NW"]);
    expect(searchPlaces(index, "peachtree street").streets.map((h) => h.label)).toEqual([
      "PEACHTREE ST NE",
      "W PEACHTREE ST NW",
    ]);
    const road = streets[0];
    expect(road.kind === "street" && road.box).toEqual([10, 10, 21, 31]);
  });

  it("finds an address by house number, exact matches first", () => {
    const { addresses } = searchPlaces(index, "3393 peachtree");
    expect(addresses[0]).toEqual({ kind: "address", label: "3393 PEACHTREE RD NE", count: 40, x: 20, y: 30, id: 1 });
    // A partial number still finds candidates, busiest first.
    expect(searchPlaces(index, "339 peachtree").addresses.map((h) => h.label)).toEqual([
      "339 W PEACHTREE ST NW",
      "3393 PEACHTREE RD NE",
      "3395 PEACHTREE RD NE",
    ]);
    expect(searchPlaces(index, "9999 peachtree").addresses).toEqual([]);
  });

  it("finds numbered streets and intersections", () => {
    expect(searchPlaces(index, "10th").streets.map((h) => h.label)).toEqual(["10TH ST NE"]);
    expect(searchPlaces(index, "peachtree and 10th").crossings.map((h) => h.label)).toEqual([
      "PEACHTREE ST NE / 10TH ST NE",
    ]);
    expect(searchPlaces(index, "1")).toEqual({ addresses: [], streets: [], crossings: [] });
  });

  it("finds neighborhoods, zones and NPUs", () => {
    expect(searchAreas(areas, "peach").map((h) => h.label)).toEqual(["Peachtree Hills"]);
    expect(searchAreas(areas, "town").map((h) => h.label)).toEqual([]); // word prefixes, not substrings
    expect(searchAreas(areas, "zone 5")[0]).toMatchObject({ areaKind: "zone", id: 1, label: "Zone 5" });
    expect(searchAreas(areas, "npu m")[0]).toMatchObject({ areaKind: "npu", id: 2, label: "NPU M" });
    expect(searchAreas(areas, "")).toEqual([]);
  });

  it("writes street names in mixed case", () => {
    expect(displayName("PEACHTREE ST NE / 10TH ST NE")).toBe("Peachtree St NE / 10th St NE");
    expect(displayName("3393 PEACHTREE RD NE")).toBe("3393 Peachtree Rd NE");
    expect(displayName("I-75 NB EXPY NW")).toBe("I-75 NB Expy NW");
  });
});

describe("outside place search", () => {
  const box = { west: -84.75, south: 33.5, east: -84.15, north: 34.0 };

  it("builds requests limited to the map's area", () => {
    const photon = new URL(photonUrl("piedmont park", box));
    expect(photon.origin + photon.pathname).toBe("https://photon.komoot.io/api/");
    expect(photon.searchParams.get("q")).toBe("piedmont park");
    expect(photon.searchParams.get("bbox")).toBe("-84.75,33.5,-84.15,34");
    const nominatim = new URL(nominatimUrl("lenox & 5th", box));
    expect(nominatim.origin + nominatim.pathname).toBe("https://nominatim.openstreetmap.org/search");
    expect(nominatim.searchParams.get("q")).toBe("lenox & 5th");
    expect(nominatim.searchParams.get("viewbox")).toBe("-84.75,34,-84.15,33.5");
    expect(nominatim.searchParams.get("bounded")).toBe("1");
  });

  it("reads Photon results and drops ones outside the map or without a name", () => {
    const body = {
      features: [
        {
          geometry: { coordinates: [-84.3718862, 33.7890478] },
          properties: { name: "Piedmont Park", osm_value: "park", street: "Monroe Drive NE", city: "Atlanta" },
        },
        { geometry: { coordinates: [-84.38, 33.78] }, properties: { street: "10th Street NE", housenumber: "250", osm_value: "yes" } },
        { geometry: { coordinates: [-83.0, 33.9] }, properties: { name: "Too far east" } },
        { geometry: { coordinates: [-84.3, 33.7] }, properties: {} },
        { properties: { name: "No position" } },
      ],
    };
    expect(parsePhoton(body, box)).toEqual([
      { label: "Piedmont Park", note: "Park · Monroe Drive NE · Atlanta", lng: -84.3718862, lat: 33.7890478 },
      { label: "250 10th Street NE", note: "", lng: -84.38, lat: 33.78 },
    ]);
    expect(parsePhoton(null, box)).toEqual([]);
    expect(parsePhoton({ features: "nope" }, box)).toEqual([]);
  });

  it("reads Nominatim results", () => {
    const body = [
      {
        name: "Piedmont Park",
        display_name: "Piedmont Park, Monroe Drive Northeast, Midtown, Atlanta, Fulton County, Georgia, 30309, United States",
        type: "park",
        lat: "33.7890478",
        lon: "-84.3718862",
      },
      { name: "", display_name: "Unnamed Road, Atlanta", type: "swimming_pool", lat: "33.7", lon: "-84.3" },
      { name: "Elsewhere", display_name: "Elsewhere", lat: "40.0", lon: "-74.0" },
      { name: "Broken", lat: "x", lon: "y" },
    ];
    expect(parseNominatim(body, box)).toEqual([
      { label: "Piedmont Park", note: "Park · Monroe Drive Northeast, Midtown", lng: -84.3718862, lat: 33.7890478 },
      { label: "Unnamed Road", note: "Swimming pool · Atlanta", lng: -84.3, lat: 33.7 },
    ]);
    expect(parseNominatim({ error: "blocked" }, box)).toEqual([]);
  });
});

describe("street filter", () => {
  const index: SearchIndex = {
    streets: [
      // number, x, y, incidents, address id
      { n: "PEACHTREE ST NE", c: 9, a: [100, 0, 0, 4, 11, 200, 10, 0, 3, 12, 300, 10, 10, 2, 13] },
      { n: "10TH ST NE", c: 5, a: [33, 60, 70, 5, 21] },
    ],
    crossings: [
      ["PEACHTREE ST NE / 10TH ST NE", 0, 10, 6, 31],
      ["PRYOR ST / BASS ST", 5, 5, 2, 32],
    ],
  };

  it("collects a street's address ids, including intersections that name it", () => {
    const filter = streetFilter(index, "PEACHTREE ST NE")!;
    expect(filter.ids).toEqual([11, 12, 13, 31]);
    expect(filter.box).toEqual([0, 0, 10, 10]);
    expect(filter.ring).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]); // outline built on the device
    expect(streetFilter(index, "10TH ST NE")!.ids).toEqual([21, 31]);
    expect(streetFilter(index, "NO SUCH ST")).toBeNull();
  });

  it("gives a one-address street no shape to draw", () => {
    const lone: SearchIndex = { streets: [{ n: "HOGUE ST NE", c: 1, a: [64, 5, 6, 1, 9] }], crossings: [] };
    const filter = streetFilter(lone, "HOGUE ST NE")!;
    expect(filter.ring).toEqual([[5, 6]]);
    expect(filter.box).toEqual([5, 6, 5, 6]);
  });

  it("limits every count to rows at the street's addresses", () => {
    // Rows 0 and 4 share address 70000; row 1 has address 7.
    const mask = new Uint8Array(70001);
    mask[70000] = 1;
    const s = summarize(points, { ...all, addresses: mask }, sizes);
    expect(s.total).toBe(2);
    expect([...s.style]).toEqual([0, 255, 255, 255, 0, 255]);
    expect([...s.byOffense]).toEqual([2, 0, 0]);
    // An id beyond the table is simply not on the street.
    expect(summarize(points, { ...all, addresses: new Uint8Array(8).fill(1) }, sizes).total).toBe(4);
  });
});

describe("convex hull", () => {
  it("keeps only the outer corners", () => {
    const square: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    expect(convexHull([...square, [1, 1], [2, 3], [4, 2], ...square])).toEqual([[0, 0], [4, 0], [4, 4], [0, 4]]);
    expect(convexHull([[5, 5]])).toEqual([[5, 5]]);
    expect(convexHull([[0, 0], [2, 2], [1, 1]])).toEqual([[0, 0], [2, 2]]);
    expect(convexHull([])).toEqual([]);
  });
});

describe("incidents per address", () => {
  it("counts each visible incident once, however many offenses it has", () => {
    // Rows 0-1 are one report at address 5 (two offenses); row 2 another report there;
    // row 3 has no address; rows 4-5 are one report at address 9, its second offense filtered out.
    const flags = Uint8Array.from([0, 8, 0, 0, 0, 8]);
    const address = Uint32Array.from([5, 5, 5, 0, 9, 9]);
    const style = Uint8Array.from([1, 1, 0, 2, 0, HIDDEN]);
    const counts = incidentsByAddress({ flags, address } as never, { i0: 0, i1: 6, style } as never);
    expect(counts[5]).toBe(2);
    expect(counts[9]).toBe(1);
    expect(counts[0]).toBe(0); // "no address" is never a place to link to
    // Only rows in the date range are counted.
    expect(incidentsByAddress({ flags, address } as never, { i0: 2, i1: 4, style } as never)[5]).toBe(1);
    // A report whose rows are all filtered out is not counted.
    const hidden = Uint8Array.from([HIDDEN, HIDDEN, 0, 2, 0, HIDDEN]);
    expect(incidentsByAddress({ flags, address } as never, { i0: 0, i1: 6, style: hidden } as never)[5]).toBe(1);
  });
});
