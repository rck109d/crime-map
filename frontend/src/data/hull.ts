export type XY = readonly [number, number];

/**
 * Corners of the smallest convex shape containing `points`, counter-clockwise
 * (Andrew's monotone chain; the same method the site builder uses for area
 * outlines). Fewer than three distinct points, or points all on one line,
 * come back as one or two points.
 */
export function convexHull(points: readonly XY[]): XY[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique: XY[] = [];
  for (const p of sorted) {
    const last = unique[unique.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) unique.push(p);
  }
  if (unique.length <= 2) return unique;

  const cross = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XY[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XY[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
