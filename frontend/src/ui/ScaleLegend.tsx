import { theme } from "../state";
import { THEMES } from "../theme";
import { fmtCompact } from "./format";

/** Key for a sequential colour scale: one swatch per class with its range. */
export function ScaleLegend({ breaks, label }: { breaks: number[]; label: string }) {
  const ramp = THEMES[theme.value].ramp;
  return (
    <div class="scale" aria-label={`${label}: color scale`}>
      <span class="scale-label">{label}</span>
      <ol>
        {breaks.map((upper, k) => {
          const lower = k === 0 ? 1 : breaks[k - 1] + 1;
          return (
            <li key={k}>
              <span class="swatch" style={{ background: ramp[k] }} />
              <span>{lower === upper ? fmtCompact(lower) : `${fmtCompact(lower)}–${fmtCompact(upper)}`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
