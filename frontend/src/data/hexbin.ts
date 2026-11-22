import { HIDDEN, type Summary } from "./filter";
import type { Geo } from "./geo";
import { NO_COORD, type Points } from "./types";

const SQRT3 = Math.sqrt(3);
const OFFSET = 32_768;

export interface HexCell {
  q: number;
  r: number;
  count: number;
}

/** Axial coordinates of the pointy-top hexagon (circumradius `radius` m) containing a point. */
export function hexAt(mx: number, my: number, radius: number): [number, number] {
  const qf = ((SQRT3 / 3) * mx - my / 3) / radius;
  const rf = ((2 / 3) * my) / radius;
  // Cube rounding.
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

const keyOf = (q: number, r: number) => (q + OFFSET) * 65_536 + (r + OFFSET);

/** Count visible, mapped rows per hexagon. */
export function binHex(points: Points, s: Summary, geo: Geo, radius: number): HexCell[] {
  const counts = new Map<number, number>();
  const { x, y } = points;
  for (let i = s.i0; i < s.i1; i++) {
    if (s.style[i] === HIDDEN || x[i] === NO_COORD) continue;
    const [q, r] = hexAt(x[i] * geo.mPerX, y[i] * geo.mPerY, radius);
    const key = keyOf(q, r);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const cells: HexCell[] = [];
  for (const [key, count] of counts) {
    cells.push({ q: Math.floor(key / 65_536) - OFFSET, r: (key % 65_536) - OFFSET, count });
  }
  return cells;
}

/** Visible rows inside one hexagon, newest first. */
export function rowsInHex(
  points: Points,
  s: Summary,
  geo: Geo,
  radius: number,
  q: number,
  r: number,
  limit = 500,
): number[] {
  const out: number[] = [];
  const { x, y } = points;
  for (let i = s.i1 - 1; i >= s.i0 && out.length < limit; i--) {
    if (s.style[i] === HIDDEN || x[i] === NO_COORD) continue;
    const [hq, hr] = hexAt(x[i] * geo.mPerX, y[i] * geo.mPerY, radius);
    if (hq === q && hr === r) out.push(i);
  }
  return out;
}

/** Closed lng/lat ring for a hexagon, shrunk slightly so neighbours show a gap. */
export function hexRing(q: number, r: number, radius: number, geo: Geo, inset = 0.94) {
  const cx = radius * SQRT3 * (q + r / 2);
  const cy = radius * 1.5 * r;
  const ring: [number, number][] = [];
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (30 + 60 * k);
    const mx = cx + radius * inset * Math.cos(a);
    const my = cy + radius * inset * Math.sin(a);
    ring.push([geo.lng(mx / geo.mPerX), geo.lat(my / geo.mPerY)]);
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * Upper bounds of each colour class for counts 1..max, on a square-root scale
 * (so busy downtown cells do not flatten everything else into one colour).
 */
export function hexBreaks(max: number, classes: number): number[] {
  const breaks: number[] = [];
  for (let k = 1; k <= classes; k++) {
    const upper = Math.max(1, Math.round(max * (k / classes) ** 2));
    if (breaks.length === 0 || upper > breaks[breaks.length - 1]) breaks.push(upper);
  }
  return breaks;
}

export function classOf(count: number, breaks: number[]): number {
  for (let k = 0; k < breaks.length; k++) if (count <= breaks[k]) return k;
  return breaks.length - 1;
}
