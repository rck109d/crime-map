import { useMemo, useState } from "preact/hooks";
import { dateTicks, formatLong, formatMonth, formatShort, type Calendar } from "../data/dates";
import { gaussianSmooth, niceTicks } from "../data/smooth";
import { GROUP_COUNT } from "../data/types";
import { applied, calendar, groupsOn, smoothing, smoothingRadius, summary, theme } from "../state";
import { GROUP_LABELS, GROUP_ORDER, THEMES } from "../theme";
import { fmt, fmt1, fmtCompact } from "./format";
import { useWidth } from "./hooks";
import { ChartIcon, TableIcon } from "./icons";

const HEIGHT = 232;
const PAD = { top: 12, right: 78, bottom: 26, left: 38 };
const SMOOTHING_CHOICES = [
  { value: -1, label: "Auto" },
  { value: 0, label: "Off" },
  { value: 3, label: "3 d" },
  { value: 7, label: "7 d" },
  { value: 30, label: "30 d" },
];

interface Series {
  group: number;
  raw: Float64Array;
  values: Float64Array;
}

export function TrendChart() {
  const s = summary.value;
  const cal = calendar.value;
  const range = applied.value;
  const radius = smoothingRadius.value;
  const on = groupsOn.value;
  const colors = THEMES[theme.value].groups;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const days = range.d1 - range.d0 + 1;

  const series = useMemo<Series[]>(() => {
    if (!s || s.daily.length !== days * GROUP_COUNT) return [];
    const out: Series[] = [];
    // Same order as the category chips, so the legend, tooltip and table match them.
    for (const g of GROUP_ORDER) {
      if (!on[g]) continue;
      const raw = new Float64Array(days);
      let sum = 0;
      for (let d = 0; d < days; d++) sum += raw[d] = s.daily[d * GROUP_COUNT + g];
      if (sum > 0) out.push({ group: g, raw, values: gaussianSmooth(raw, radius) });
    }
    return out;
  }, [s, days, radius, on]);

  if (!s || !cal) return null;

  const controls = (
    <div class="card-tools">
      <span class="tools-label">Smoothing</span>
      <div class="segmented segmented-small" role="group" aria-label="Smoothing">
        {SMOOTHING_CHOICES.map((c) => (
          <button key={c.value} aria-pressed={smoothing.value === c.value} onClick={() => (smoothing.value = c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      <button class="icon-button" onClick={() => setAsTable(!asTable)} aria-label={asTable ? "Show chart" : "Show as table"}>
        {asTable ? <ChartIcon /> : <TableIcon />}
      </button>
    </div>
  );
  const subtitle =
    radius > 0
      ? `Incidents per day, smoothed (Gaussian moving average, ${radius}-day radius)`
      : "Incidents per day";

  let body;
  if (series.length === 0) {
    body = <p class="empty">No incidents match these filters.</p>;
  } else if (asTable) {
    body = <TrendTable series={series} d0={range.d0} days={days} cal={cal} />;
  } else if (days < 3) {
    body = <p class="empty">Choose a range of at least three days to see a trend.</p>;
  } else {
    const plotW = Math.max(40, width - PAD.left - PAD.right);
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    let max = 0;
    for (const sr of series) for (const v of sr.values) if (v > max) max = v;
    const yTicks = niceTicks(max);
    const yMax = yTicks[yTicks.length - 1];
    const x = (d: number) => PAD.left + (d / (days - 1)) * plotW;
    const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
    const xTicks = dateTicks(range.d0, days, cal, Math.floor(plotW / 58));

    // End labels: keep the legend for any that would collide rather than nudging them apart.
    const ends = series
      .map((sr) => ({ group: sr.group, y: y(sr.values[days - 1]) }))
      .sort((a, b) => a.y - b.y);
    const labelled = new Set<number>();
    let lastY = -Infinity;
    for (const e of ends) {
      if (e.y - lastY >= 13) {
        labelled.add(e.group);
        lastY = e.y;
      }
    }

    const move = (clientX: number, target: Element) => {
      const box = target.getBoundingClientRect();
      const d = Math.round(((clientX - box.left - PAD.left) / plotW) * (days - 1));
      setHover(Math.min(days - 1, Math.max(0, d)));
    };
    const tipLeft = hover !== null && x(hover) > width / 2;

    body = (
      <div class="chart" ref={ref}>
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Line chart: ${subtitle.toLowerCase()}, by category. Use the table view for exact values.`}
            tabIndex={0}
            onPointerMove={(e) => move(e.clientX, e.currentTarget)}
            onPointerDown={(e) => move(e.clientX, e.currentTarget)}
            onPointerLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const step = e.key === "ArrowLeft" ? -1 : 1;
              setHover((h) => Math.min(days - 1, Math.max(0, (h ?? days - 1) + step)));
            }}
          >
            {yTicks.map((t) => (
              <g key={t}>
                <line class={t === 0 ? "axis" : "grid"} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} />
                <text class="tick" x={PAD.left - 6} y={y(t)} dy="0.32em" text-anchor="end">
                  {fmtCompact(t)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => (
              <text key={t.day} class="tick" x={x(t.day)} y={HEIGHT - 8} text-anchor="middle">
                {t.label}
              </text>
            ))}
            {series.map((sr) => {
              let d = "";
              for (let i = 0; i < days; i++) d += `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(sr.values[i]).toFixed(1)}`;
              return <path key={sr.group} d={d} fill="none" stroke={colors[sr.group]} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />;
            })}
            {series.map(
              (sr) =>
                labelled.has(sr.group) && (
                  <text key={sr.group} class="end-label" x={PAD.left + plotW + 8} y={y(sr.values[days - 1])} dy="0.32em">
                    {GROUP_LABELS[sr.group]}
                  </text>
                ),
            )}
            {hover !== null && (
              <g>
                <line class="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
                {series.map((sr) => (
                  <circle key={sr.group} class="marker" cx={x(hover)} cy={y(sr.values[hover])} r="4" fill={colors[sr.group]} />
                ))}
              </g>
            )}
          </svg>
        )}
        {hover !== null && (
          <div
            class="tooltip"
            style={tipLeft ? { right: `${width - x(hover) + 10}px` } : { left: `${x(hover) + 10}px` }}
          >
            <div class="tooltip-title">{formatLong(cal.date(range.d0 + hover))}</div>
            {series.map((sr) => (
              <div class="tooltip-row" key={sr.group}>
                <span class="line-key" style={{ background: colors[sr.group] }} />
                <strong>{radius > 0 ? fmt1(sr.values[hover]) : fmt(sr.raw[hover])}</strong>
                <span>{GROUP_LABELS[sr.group]}</span>
              </div>
            ))}
            {radius > 0 && <div class="tooltip-note">smoothed, per day</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <figure class="card">
      <figcaption class="stacked">
        <div>
          <h3>Trend</h3>
          <p class="card-sub">{subtitle}</p>
        </div>
        {controls}
      </figcaption>
      <ul class="legend" aria-label="Categories">
        {series.map((sr) => (
          <li key={sr.group}>
            <span class="line-key" style={{ background: colors[sr.group] }} />
            {GROUP_LABELS[sr.group]}
          </li>
        ))}
      </ul>
      {body}
      <p class="fine">The most recent days are usually incomplete: APD keeps adding reports for days afterwards.</p>
    </figure>
  );
}

function TrendTable({ series, d0, days, cal }: { series: Series[]; d0: number; days: number; cal: Calendar }) {
  const rows = useMemo(() => {
    const unit = days <= 31 ? "day" : days <= 120 ? "week" : "month";
    const out: { label: string; values: number[] }[] = [];
    let key = "";
    for (let d = 0; d < days; d++) {
      const date = cal.date(d0 + d);
      const k =
        unit === "day"
          ? String(d)
          : unit === "week"
            ? String(Math.floor(d / 7))
            : `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
      if (k !== key) {
        key = k;
        out.push({
          label:
            unit === "day"
              ? formatShort(date)
              : unit === "week"
                ? `Week of ${formatShort(date)}`
                : `${formatMonth(date)} ${date.getUTCFullYear()}`,
          values: series.map(() => 0),
        });
      }
      const row = out[out.length - 1];
      series.forEach((sr, i) => (row.values[i] += sr.raw[d]));
    }
    return out;
  }, [series, d0, days, cal]);
  return (
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Period</th>
            {series.map((sr) => (
              <th scope="col" key={sr.group}>
                {GROUP_LABELS[sr.group]}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.values.map((v, i) => (
                <td key={i}>{fmt(v)}</td>
              ))}
              <td>{fmt(row.values.reduce((a, b) => a + b, 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
