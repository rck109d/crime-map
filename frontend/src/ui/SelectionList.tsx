import { useEffect, useState } from "preact/hooks";
import { formatLong, formatMinute, formatShort, formatWeekday } from "../data/dates";
import { HIDDEN } from "../data/filter";
import { locate } from "../data/format";
import { groupByIncident } from "../data/incidents";
import { loadDetail } from "../data/load";
import { FLAG_FAMILY, FLAG_FIREARM, type MonthDetail } from "../data/types";
import { mapApi, PLACE_METERS } from "../map/MapView";
import {
  calendar,
  clearFilters,
  manifest,
  points,
  resolvePreset,
  selection,
  setRange,
  summary,
  theme,
} from "../state";
import { THEMES } from "../theme";
import { fmt, plural } from "./format";
import { BackIcon } from "./icons";

const PAGE = 25;
/** The map hands over at most this many rows, so a full list may be incomplete. */
const ROW_LIMIT = 500;

/** "2026-10-10T17:00" -> "Oct 10, 5:00 PM" */
function formatStamp(stamp: string): string {
  const [date, time] = stamp.split("T");
  if (!date || !time) return stamp;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return `${formatShort(new Date(Date.UTC(y, m - 1, d)))}, ${formatMinute(hh * 60 + mm)}`;
}

export function SelectionHeader() {
  const sel = selection.value;
  const p = points.value;
  if (!sel || !p) return null;
  const count = groupByIncident(p.flags, sel.rows).length;
  const title =
    count === 0
      ? "Nothing here matches"
      : (sel.rows.length >= ROW_LIMIT ? `${fmt(count)}+ incidents` : plural(count, "incident")) +
        (sel.kind === "cell"
          ? " in this cell"
          : sel.kind === "address"
            ? " at this address"
            : sel.kind === "place"
              ? ` within ${PLACE_METERS} m`
              : count > 1
                ? " here"
                : "");
  return (
    <div class="selection-head">
      <button class="icon-button" onClick={() => (selection.value = null)} aria-label="Back to summary">
        <BackIcon />
      </button>
      <div>
        <h3>{title}</h3>
        {/* The address, when this spot was reached by searching for one. */}
        {sel.label && <p class="selection-sub">{sel.label}</p>}
      </div>
    </div>
  );
}

/**
 * One card per incident. APD publishes a row per offense, so the offenses
 * recorded under one report are gathered onto a single card.
 */
export function SelectionList() {
  const sel = selection.value;
  const p = points.value;
  const m = manifest.value;
  const cal = calendar.value;
  const s = summary.value;
  const [details, setDetails] = useState<Map<string, MonthDetail>>(new Map());
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    setLimit(PAGE);
    setFailed(false);
  }, [sel]);

  const incidents = sel && p ? groupByIncident(p.flags, sel.rows) : [];
  const shown = incidents.slice(0, limit);
  // Every row of a report falls in the same month file.
  const where = p ? shown.map((run) => locate(p, run.start)) : [];
  const months = [...new Set(where.flatMap((w) => (w ? [w.month] : [])))].sort();
  const monthsKey = months.join(",");
  useEffect(() => {
    if (!m || months.length === 0) return;
    let live = true;
    for (const month of months) {
      if (details.has(month)) continue;
      loadDetail(m, month).then(
        (d) => live && setDetails((prev) => new Map(prev).set(month, d)),
        () => live && setFailed(true),
      );
    }
    return () => {
      live = false;
    };
  }, [monthsKey, m]);

  if (!sel || !p || !m || !cal) return null;
  const colors = THEMES[theme.value].groups;

  return (
    <div class="selection">
      {failed && <p class="empty">Could not load the details for these incidents. Check your connection and tap the map again.</p>}
      {incidents.length === 0 && (
        <div class="empty-spot">
          <p>
            {sel.kind === "place"
              ? `No incidents within ${PLACE_METERS} m of this place match your date range and filters.`
              : "No incidents at this address match your date range and filters."}
          </p>
          {sel.known ? <p class="fine">{plural(sel.known, "incident")} reported here since 2021.</p> : null}
          <button
            class="button"
            onClick={async () => {
              const { at, kind, address = 0, label = "", known = 0 } = sel;
              await setRange(resolvePreset("all"));
              clearFilters();
              if (kind === "place") mapApi.showPlace(at, label);
              else mapApi.showAddress(at, address, label, known);
            }}
          >
            Show all dates, without filters
          </button>
        </div>
      )}
      <ul class="incidents">
        {shown.map((run, k) => {
          const w = where[k];
          const d = w ? details.get(w.month) : undefined;
          const first = run.start;
          const rows = Array.from({ length: run.end - run.start }, (_, i) => run.start + i);
          // Row of the detail file for each offense of this incident.
          const detailRow = (row: number) => (w ? w.row + (row - first) : -1);
          const reported = cal.date(p.day[first]);
          const place = [m.nhoods[p.nhood[first]], m.zones[p.zone[first]], m.npus[p.npu[first]] && `NPU ${m.npus[p.npu[first]]}`]
            .filter(Boolean)
            .join(" · ");
          const firearm = rows.some((row) => p.flags[row] & FLAG_FIREARM);
          const family = rows.some((row) => p.flags[row] & FLAG_FAMILY);
          const at = detailRow(first);
          return (
            <li key={first} class="incident">
              <div class="incident-title">
                <ul class="offenses" aria-label={rows.length > 1 ? `${rows.length} offenses` : undefined}>
                  {rows.map((row) => {
                    const offense = m.offenses[p.offense[row]];
                    const victims = d ? Number(d.vic[detailRow(row)]) : 0;
                    // Part of the incident, but not matching the filters in use.
                    const filteredOut = s ? s.style[row] === HIDDEN : false;
                    return (
                      <li key={row} class={filteredOut ? "offense-muted" : ""}>
                        <span class="dot" style={{ background: colors[offense.group] }} />
                        <span>
                          {offense.name}
                          {victims > 0 && <span class="offense-note">{plural(victims, "victim")}</span>}
                          {filteredOut && <span class="offense-note">outside your filters</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {(firearm || family) && (
                  <div class="badges">
                    {firearm && <span class="badge">Firearm</span>}
                    {family && <span class="badge">Family violence</span>}
                  </div>
                )}
              </div>
              <dl>
                <dt>Reported</dt>
                <dd>
                  {formatWeekday(reported)}, {formatLong(reported)} · {formatMinute(p.minute[first])}
                </dd>
                {d && w ? (
                  <>
                    <dt>Occurred</dt>
                    <dd>
                      {formatStamp(d.from[at])}
                      {d.to[at] && d.to[at] !== d.from[at] ? ` – ${formatStamp(d.to[at])}` : ""}
                    </dd>
                    <dt>Location</dt>
                    <dd>{d.addr[at] || "Not recorded"}</dd>
                    {m.locationTypes[d.loc[at]] && (
                      <>
                        <dt>Place</dt>
                        <dd>{m.locationTypes[d.loc[at]]}</dd>
                      </>
                    )}
                  </>
                ) : (
                  !failed && (
                    <>
                      <dt>Location</dt>
                      <dd class="loading-text">Loading…</dd>
                    </>
                  )
                )}
                {place && (
                  <>
                    <dt>Area</dt>
                    <dd>
                      {place}
                      {d && w && d.beat[at] ? ` · Beat ${d.beat[at]}` : ""}
                    </dd>
                  </>
                )}
                {d && w && (
                  <>
                    <dt>Report</dt>
                    <dd class="mono">{d.rep?.[at] ? `${d.inc[at]}-${d.rep[at]}` : d.inc[at]}</dd>
                  </>
                )}
              </dl>
            </li>
          );
        })}
      </ul>
      {incidents.length > limit && (
        <button class="link" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, incidents.length - limit)} more
        </button>
      )}
    </div>
  );
}
