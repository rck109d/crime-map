import type { Calendar } from "./dates";
import type { Manifest } from "./types";

/** A covered span in day indexes, inclusive. */
export interface Span {
  source: string;
  d0: number;
  d1: number;
}

/** The spans of report dates the data covers, ascending. */
export function coverageSpans(manifest: Manifest, cal: Calendar): Span[] {
  const list = manifest.coverage ?? [{ source: "nibrs", from: manifest.epoch, to: manifest.through }];
  return list.map((c) => ({ source: c.source, d0: cal.dayOf(c.from), d1: cal.dayOf(c.to) }));
}

/** Per day of [d0, d1]: 1 when the data covers it, 0 in a gap. */
export function coverageMask(spans: readonly Span[], d0: number, d1: number): Uint8Array {
  const mask = new Uint8Array(Math.max(0, d1 - d0 + 1));
  for (const s of spans) {
    for (let d = Math.max(s.d0, d0); d <= Math.min(s.d1, d1); d++) mask[d - d0] = 1;
  }
  return mask;
}

/** Spans of [d0, d1] the data does not cover. */
export function gaps(spans: readonly Span[], d0: number, d1: number): { d0: number; d1: number }[] {
  const out: { d0: number; d1: number }[] = [];
  let at = d0;
  for (const s of spans) {
    if (s.d0 > at && at <= d1) out.push({ d0: at, d1: Math.min(s.d0 - 1, d1) });
    at = Math.max(at, s.d1 + 1);
  }
  if (at <= d1) out.push({ d0: at, d1 });
  return out;
}

/** Whether [d0, d1] reaches into a span from `source`. */
export function overlaps(spans: readonly Span[], source: string, d0: number, d1: number): boolean {
  return spans.some((s) => s.source === source && s.d0 <= d1 && s.d1 >= d0);
}
