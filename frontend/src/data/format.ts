import type { Manifest, PointColumns, Points, Segment, YearInfo } from "./types";

const MAGIC = [0x43, 0x4d, 0x41, 0x50]; // "CMAP"
const HEADER_BYTES = 12;
const U16_COLUMNS = ["day", "minute", "x", "y", "nhood", "addrLo"] as const;
const U8_COLUMNS = ["offense", "npu", "zone", "flags", "occHour", "occDow", "addrHi"] as const;
const FORMAT_VERSION = 2;

/** Decode one (already decompressed) points-YYYY.bin file. */
export function decodePoints(buffer: ArrayBuffer): PointColumns {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEADER_BYTES || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error("not a crime-map points file");
  }
  const view = new DataView(buffer);
  const version = view.getUint16(4, true);
  if (version !== FORMAT_VERSION) {
    // Most likely an older copy of this page reading newer data: reloading fixes it.
    throw new Error(`The map data is newer than this page (format ${version}). Reload to update.`);
  }
  const count = view.getUint32(8, true);
  const expected = HEADER_BYTES + count * (U16_COLUMNS.length * 2 + U8_COLUMNS.length);
  if (bytes.length !== expected) {
    throw new Error(`points file is ${bytes.length} bytes, expected ${expected}`);
  }

  const out = { count } as PointColumns;
  let offset = HEADER_BYTES;
  for (const name of U16_COLUMNS) {
    // The file is little-endian; copy through a DataView on big-endian hosts.
    out[name] = readU16(buffer, offset, count);
    offset += count * 2;
  }
  for (const name of U8_COLUMNS) {
    out[name] = bytes.slice(offset, offset + count);
    offset += count;
  }
  return out;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function readU16(buffer: ArrayBuffer, offset: number, count: number): Uint16Array {
  if (LITTLE_ENDIAN) return new Uint16Array(buffer.slice(offset, offset + count * 2));
  const view = new DataView(buffer, offset, count * 2);
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}

/** gzip magic number: the data files are stored compressed. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Join per-year tables (in ascending year order) into one table. */
export function combineYears(
  manifest: Manifest,
  loaded: ReadonlyMap<number, PointColumns>,
): Points {
  const years = [...loaded.keys()].sort((a, b) => a - b);
  const infos = new Map<number, YearInfo>(manifest.years.map((y) => [y.year, y]));
  const count = years.reduce((n, y) => n + loaded.get(y)!.count, 0);

  const out = { count, years } as Points;
  for (const name of U16_COLUMNS) out[name] = new Uint16Array(count);
  for (const name of U8_COLUMNS) out[name] = new Uint8Array(count);

  const segments: Segment[] = [];
  let offset = 0;
  for (const year of years) {
    const cols = loaded.get(year)!;
    for (const name of U16_COLUMNS) out[name].set(cols[name], offset);
    for (const name of U8_COLUMNS) out[name].set(cols[name], offset);
    let start = offset;
    for (const m of infos.get(year)?.months ?? []) {
      segments.push({ month: m.month, start, count: m.count });
      start += m.count;
    }
    if (start !== offset + cols.count) {
      throw new Error(`manifest and points file disagree for ${year}`);
    }
    offset += cols.count;
  }
  out.segments = segments;

  const groupOf = Uint8Array.from(manifest.offenses, (o) => o.group);
  const group = new Uint8Array(count);
  const offense = out.offense;
  // The address id is stored split across a 16-bit and an 8-bit column.
  const address = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    group[i] = groupOf[offense[i]];
    address[i] = out.addrLo[i] | (out.addrHi[i] << 16);
  }
  out.group = group;
  out.address = address;
  return out;
}

/** Which month file, and which row of it, holds point `index`. */
export function locate(points: Points, index: number): { month: string; row: number } | null {
  let lo = 0;
  let hi = points.segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = points.segments[mid];
    if (index < seg.start) hi = mid - 1;
    else if (index >= seg.start + seg.count) lo = mid + 1;
    else return { month: seg.month, row: index - seg.start };
  }
  return null;
}

/** First index whose day is >= `day` (rows are sorted by report date). */
export function lowerBoundDay(days: Uint16Array, day: number): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
