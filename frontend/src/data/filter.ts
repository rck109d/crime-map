import { lowerBoundDay } from "./format";
import { pointInRing, type Ring } from "./geo";
import { FLAG_FAMILY, FLAG_FIREARM, GROUP_COUNT, NO_COORD, UNKNOWN, type Points } from "./types";

export type AreaKind = "nhood" | "npu" | "zone";

export interface Filters {
  /** Inclusive day range. */
  d0: number;
  d1: number;
  /** Which colour groups are switched on. */
  groups: readonly boolean[];
  /** Offense ids to keep, or null for every offense. */
  offenses: ReadonlySet<number> | null;
  area: { kind: AreaKind; id: number } | null;
  /** Drawn area, in quantized coordinates. */
  polygon: Ring | null;
  /** Flag bits a row must all have (firearm, family violence, Part I); 0 for no requirement. */
  requireFlags: number;
}

export const HIDDEN = 255;

export interface Summary {
  /** Rows [i0, i1) fall inside the date range. */
  i0: number;
  i1: number;
  /** Per row: its colour group if it passes every filter, else HIDDEN. */
  style: Uint8Array;
  total: number;
  /** Visible rows that have a map position. */
  mapped: number;
  firearm: number;
  familyViolence: number;
  /** Counts ignoring the group switches (so a switched-off group still shows its size). */
  byGroup: Uint32Array;
  /** Counts ignoring the group switches and the offense selection. */
  byOffense: Uint32Array;
  /** Counts ignoring the area filter. */
  byArea: Record<AreaKind, Uint32Array>;
  /** Visible rows per day and group: daily[(day - d0) * GROUP_COUNT + group]. */
  daily: Uint32Array;
  /** Visible rows by when the offense began: hourDow[dow * 24 + hour]. */
  hourDow: Uint32Array;
}

export interface Sizes {
  offenses: number;
  nhoods: number;
  npus: number;
  zones: number;
}

/** One pass over the date range: apply the filters and count everything the UI shows. */
export function summarize(points: Points, f: Filters, sizes: Sizes): Summary {
  const d0 = Math.max(0, f.d0);
  const d1 = Math.max(d0, f.d1);
  const i0 = lowerBoundDay(points.day, d0);
  const i1 = lowerBoundDay(points.day, d1 + 1);
  const days = d1 - d0 + 1;

  const style = new Uint8Array(points.count).fill(HIDDEN);
  const byGroup = new Uint32Array(GROUP_COUNT);
  const byOffense = new Uint32Array(sizes.offenses);
  const byArea = {
    nhood: new Uint32Array(sizes.nhoods),
    npu: new Uint32Array(sizes.npus),
    zone: new Uint32Array(sizes.zones),
  };
  const daily = new Uint32Array(days * GROUP_COUNT);
  const hourDow = new Uint32Array(7 * 24);

  const { day, x, y, offense, group, flags, occHour, occDow } = points;
  const areaCol = f.area ? points[f.area.kind] : null;
  const areaId = f.area ? f.area.id : 0;
  const ring = f.polygon && f.polygon.length >= 3 ? f.polygon : null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  if (ring) {
    for (const [rx, ry] of ring) {
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
  }
  const selected = f.offenses;
  let total = 0;
  let mapped = 0;
  let firearm = 0;
  let familyViolence = 0;
  const required = f.requireFlags;

  for (let i = i0; i < i1; i++) {
    if ((flags[i] & required) !== required) continue;
    const px = x[i];
    const py = y[i];
    if (ring) {
      if (px === NO_COORD || px < minX || px > maxX || py < minY || py > maxY) continue;
      if (!pointInRing(px, py, ring)) continue;
    }
    const g = group[i];
    const o = offense[i];
    const inArea = !areaCol || areaCol[i] === areaId;
    const offenseOk = !selected || selected.has(o);
    const categoryOk = offenseOk && f.groups[g];

    if (inArea) {
      byOffense[o]++;
      if (offenseOk) byGroup[g]++;
    }
    if (categoryOk) {
      byArea.nhood[points.nhood[i]]++;
      byArea.npu[points.npu[i]]++;
      byArea.zone[points.zone[i]]++;
    }
    if (!inArea || !categoryOk) continue;

    style[i] = g;
    total++;
    if (px !== NO_COORD) mapped++;
    if (flags[i] & FLAG_FIREARM) firearm++;
    if (flags[i] & FLAG_FAMILY) familyViolence++;
    daily[(day[i] - d0) * GROUP_COUNT + g]++;
    const h = occHour[i];
    if (h !== UNKNOWN) hourDow[occDow[i] * 24 + h]++;
  }

  return { i0, i1, style, total, mapped, firearm, familyViolence, byGroup, byOffense, byArea, daily, hourDow };
}

/** Bounding box (quantized) of visible rows, or null if none are mapped. */
export function visibleBounds(points: Points, s: Summary) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = s.i0; i < s.i1; i++) {
    if (s.style[i] === HIDDEN) continue;
    const px = points.x[i];
    if (px === NO_COORD) continue;
    const py = points.y[i];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return minX === Infinity ? null : { minX, maxX, minY, maxY };
}

/** Visible rows within `radius` (quantized units, per axis scale) of a position, nearest first. */
export function nearby(
  points: Points,
  s: Summary,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  limit = 500,
): number[] {
  const hits: { i: number; d: number }[] = [];
  for (let i = s.i0; i < s.i1; i++) {
    if (s.style[i] === HIDDEN) continue;
    const px = points.x[i];
    if (px === NO_COORD) continue;
    const dx = (px - cx) / radiusX;
    const dy = (points.y[i] - cy) / radiusY;
    const d = dx * dx + dy * dy;
    if (d <= 1) hits.push({ i, d });
  }
  // Nearest spot first; within one spot, newest first.
  hits.sort((a, b) => a.d - b.d || b.i - a.i);
  return hits.slice(0, limit).map((h) => h.i);
}
