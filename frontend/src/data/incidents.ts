import { FLAG_SAME_INCIDENT } from "./types";

/**
 * APD publishes one row per offense. Rows of the same report sit next to each
 * other, each after the first carrying FLAG_SAME_INCIDENT, so an incident is
 * a run of rows [start, end).
 */
export interface IncidentRun {
  start: number;
  end: number;
}

/** The whole incident that `row` is part of. */
export function incidentRun(flags: Uint8Array, row: number): IncidentRun {
  let start = row;
  while (start > 0 && flags[start] & FLAG_SAME_INCIDENT) start--;
  let end = row + 1;
  while (end < flags.length && flags[end] & FLAG_SAME_INCIDENT) end++;
  return { start, end };
}

/** The distinct incidents a list of rows belongs to, in order of first appearance. */
export function groupByIncident(flags: Uint8Array, rows: readonly number[]): IncidentRun[] {
  const seen = new Set<number>();
  const runs: IncidentRun[] = [];
  for (const row of rows) {
    const run = incidentRun(flags, row);
    if (seen.has(run.start)) continue;
    seen.add(run.start);
    runs.push(run);
  }
  return runs;
}
