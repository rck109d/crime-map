import { useEffect, useState } from "preact/hooks";
import { formatLong, formatMinute, formatShort, formatWeekday } from "../data/dates";
import { locate } from "../data/format";
import { loadDetail } from "../data/load";
import { FLAG_FIREARM, type MonthDetail } from "../data/types";
import { calendar, manifest, points, selection, theme } from "../state";
import { THEMES } from "../theme";
import { plural } from "./format";
import { BackIcon } from "./icons";

const PAGE = 25;

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
  if (!sel) return null;
  const total = sel.rows.length;
  const title =
    (total >= 500 ? "500+ incidents" : plural(total, "incident")) + (sel.kind === "cell" ? " in this cell" : total > 1 ? " here" : "");
  return (
    <div class="selection-head">
      <button class="icon-button" onClick={() => (selection.value = null)} aria-label="Back to summary">
        <BackIcon />
      </button>
      <h3>{title}</h3>
    </div>
  );
}

export function SelectionList() {
  const sel = selection.value;
  const p = points.value;
  const m = manifest.value;
  const cal = calendar.value;
  const [details, setDetails] = useState<Map<string, MonthDetail>>(new Map());
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    setLimit(PAGE);
    setFailed(false);
  }, [sel]);

  const shown = sel && p ? sel.rows.slice(0, limit) : [];
  const where = p ? shown.map((row) => locate(p, row)) : [];
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
  const total = sel.rows.length;

  return (
    <div class="selection">
      {failed && <p class="empty">Could not load the details for these incidents. Check your connection and tap the map again.</p>}
      <ul class="incidents">
        {shown.map((row, k) => {
          const w = where[k];
          const d = w ? details.get(w.month) : undefined;
          const offense = m.offenses[p.offense[row]];
          const reported = cal.date(p.day[row]);
          const place = [m.nhoods[p.nhood[row]], m.zones[p.zone[row]], m.npus[p.npu[row]] && `NPU ${m.npus[p.npu[row]]}`]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={row} class="incident">
              <div class="incident-title">
                <span class="dot" style={{ background: colors[offense.group] }} />
                <span>{offense.name}</span>
                {p.flags[row] & FLAG_FIREARM ? <span class="badge">Firearm</span> : null}
              </div>
              <dl>
                <dt>Reported</dt>
                <dd>
                  {formatWeekday(reported)}, {formatLong(reported)} · {formatMinute(p.minute[row])}
                </dd>
                {d && w ? (
                  <>
                    <dt>Occurred</dt>
                    <dd>
                      {formatStamp(d.from[w.row])}
                      {d.to[w.row] && d.to[w.row] !== d.from[w.row] ? ` – ${formatStamp(d.to[w.row])}` : ""}
                    </dd>
                    <dt>Location</dt>
                    <dd>{d.addr[w.row] || "Not recorded"}</dd>
                    {m.locationTypes[d.loc[w.row]] && (
                      <>
                        <dt>Place</dt>
                        <dd>{m.locationTypes[d.loc[w.row]]}</dd>
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
                      {d && w && d.beat[w.row] ? ` · Beat ${d.beat[w.row]}` : ""}
                    </dd>
                  </>
                )}
                {d && w && (
                  <>
                    <dt>Incident</dt>
                    <dd class="mono">{d.inc[w.row]}</dd>
                  </>
                )}
              </dl>
            </li>
          );
        })}
      </ul>
      {total > limit && (
        <button class="link" onClick={() => setLimit(limit + PAGE)}>
          Show {Math.min(PAGE, total - limit)} more
        </button>
      )}
    </div>
  );
}
