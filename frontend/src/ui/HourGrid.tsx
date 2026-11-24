import { useState } from "preact/hooks";
import { formatHour } from "../data/dates";
import { classOf, hexBreaks } from "../data/hexbin";
import { summary, theme } from "../state";
import { THEMES } from "../theme";
import { fmt } from "./format";
import { ChartIcon, TableIcon } from "./icons";
import { ScaleLegend } from "./ScaleLegend";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABELS = [0, 6, 12, 18];

/** When offenses begin: day of week by hour of day. */
export function HourGrid() {
  const s = summary.value;
  const ramp = THEMES[theme.value].ramp;
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  if (!s) return null;
  const grid = s.hourDow;
  let max = 0;
  let known = 0;
  let midnight = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] > max) max = grid[i];
    known += grid[i];
    if (i % 24 === 0) midnight += grid[i];
  }
  if (max === 0) return null;
  const breaks = hexBreaks(max, ramp.length);
  const midnightShare = Math.round((midnight / known) * 100);
  const untimed = s.total - known;

  return (
    <figure class="card">
      <figcaption>
        <div>
          <h3>When offenses begin</h3>
          <p class="card-sub">Incidents by day of week and hour, from the recorded start time</p>
        </div>
        <button class="icon-button" onClick={() => setAsTable(!asTable)} aria-label={asTable ? "Show chart" : "Show as table"}>
          {asTable ? <ChartIcon /> : <TableIcon />}
        </button>
      </figcaption>
      {asTable ? (
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Hour</th>
                {DAYS.map((d) => (
                  <th scope="col" key={d}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, h) => (
                <tr key={h}>
                  <th scope="row">{formatHour(h)}</th>
                  {DAYS.map((_, d) => (
                    <td key={d}>{fmt(grid[d * 24 + h])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div
            class="hourgrid"
            role="img"
            tabIndex={0}
            aria-label="Heat map of incidents by day of week and hour. Use the table view for exact values."
            onPointerLeave={() => setActive(null)}
            onBlur={() => setActive(null)}
            onKeyDown={(e) => {
              const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -24, ArrowDown: 24 }[e.key];
              if (!step) return;
              e.preventDefault();
              setActive((a) => Math.min(167, Math.max(0, (a ?? 0) + step)));
            }}
          >
            <div class="hourgrid-corner" />
            {Array.from({ length: 24 }, (_, h) => (
              <div class="hourgrid-hour" key={h}>
                {HOUR_LABELS.includes(h) ? formatHour(h).replace(" ", "").toLowerCase().replace("m", "") : ""}
              </div>
            ))}
            {DAYS.map((day, d) => (
              <>
                <div class="hourgrid-day" key={day}>
                  {day}
                </div>
                {Array.from({ length: 24 }, (_, h) => {
                  const i = d * 24 + h;
                  const n = grid[i];
                  return (
                    <div
                      key={i}
                      class={`cell ${active === i ? "cell-active" : ""}`}
                      style={{ background: n ? ramp[classOf(n, breaks)] : undefined }}
                      onPointerEnter={() => setActive(i)}
                      onPointerDown={() => setActive(i)}
                    />
                  );
                })}
              </>
            ))}
          </div>
          <div class="hourgrid-foot">
            <ScaleLegend breaks={breaks} label="Incidents" />
            <div class="readout" aria-live="polite">
              {active !== null && (
                <>
                  <strong>{fmt(grid[active])}</strong> {DAYS[Math.floor(active / 24)]} {formatHour(active % 24)}
                </>
              )}
            </div>
          </div>
        </>
      )}
      {untimed > 0 && (
        <p class="fine">
          {fmt(untimed)} {untimed === 1 ? "incident has" : "incidents have"} no recorded start time and{" "}
          {untimed === 1 ? "is" : "are"} left out.
        </p>
      )}
      {midnightShare >= 8 && (
        <p class="fine">
          {midnightShare}% of start times are in the midnight hour, more than any other; that hour likely includes
          reports where the exact time was not known.
        </p>
      )}
    </figure>
  );
}
