import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dateTicks, formatMinute, formatRange, makeCalendar } from "./dates";
import { toCsv, toKml, type ExportRow } from "./export";
import { nearby, summarize, visibleBounds, type Filters } from "./filter";
import { combineYears, decodePoints, isGzip, locate, lowerBoundDay } from "./format";
import { makeGeo, pointInRing } from "./geo";
import { binHex, classOf, hexAt, hexBreaks, hexRing, rowsInHex } from "./hexbin";
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

/** rows: [day, x, y, offense, nhood, npu, zone, flags, occHour, occDow] */
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
  };
}

function encode(cols: PointColumns): ArrayBuffer {
  const n = cols.count;
  const buf = new ArrayBuffer(12 + n * 16);
  const view = new DataView(buf);
  [0x43, 0x4d, 0x41, 0x50].forEach((b, i) => view.setUint8(i, b));
  view.setUint16(4, 1, true);
  view.setUint32(8, n, true);
  let o = 12;
  for (const c of [cols.day, cols.minute, cols.x, cols.y, cols.nhood]) {
    for (let i = 0; i < n; i++, o += 2) view.setUint16(o, c[i], true);
  }
  for (const c of [cols.offense, cols.npu, cols.zone, cols.flags, cols.occHour, cols.occDow]) {
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
  [0, 100, 100, 0, 1, 1, 1, 3, 13, 5],
  [0, 100, 100, 1, 1, 1, 1, 4, 0, 5],
  [3, 5000, 5000, 1, 2, 2, 1, 4, UNKNOWN, UNKNOWN],
  [40, NO_COORD, NO_COORD, 2, 0, 0, 0, 0, 9, 1],
]);
const y2022 = table([
  [366, 120, 110, 0, 1, 1, 1, 0, 22, 0],
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
  it("picks round axis ticks", () => {
    expect(niceTicks(87)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("export", () => {
  const row: ExportRow = {
    incident: "262821556",
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
    expect(header.split(",")).toHaveLength(18);
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
