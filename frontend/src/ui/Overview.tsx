import { useState } from "preact/hooks";
import { applied, groupsOn, manifest, offenseSel, summary, theme } from "../state";
import { THEMES } from "../theme";
import { fmt, fmt1 } from "./format";
import { HourGrid } from "./HourGrid";
import { CheckIcon } from "./icons";

export function Overview() {
  const s = summary.value;
  const m = manifest.value;
  const [showAll, setShowAll] = useState(false);
  if (!s || !m) return null;
  const days = applied.value.d1 - applied.value.d0 + 1;
  const colors = THEMES[theme.value].groups;
  const selected = new Set(offenseSel.value);

  const offenses = m.offenses
    .map((info, id) => ({ ...info, id, count: s.byOffense[id] }))
    .filter((o) => groupsOn.value[o.group] && (o.count > 0 || selected.has(o.id)))
    .sort((a, b) => b.count - a.count);
  const top = offenses[0]?.count ?? 0;
  const shown = showAll ? offenses : offenses.slice(0, 8);
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    offenseSel.value = [...next].sort((a, b) => a - b);
  };

  return (
    <>
      <div class="tiles">
        <div class="tile">
          <div class="tile-label">Per day</div>
          <div class="tile-value">{fmt1(s.total / days)}</div>
        </div>
        <div class="tile">
          <div class="tile-label">Firearm involved</div>
          <div class="tile-value">{fmt(s.firearm)}</div>
          <div class="tile-note">{s.total ? `${fmt1((s.firearm / s.total) * 100)}% of incidents` : " "}</div>
        </div>
        {s.total - s.mapped > 0 && (
          <div class="tile">
            <div class="tile-label">Not on the map</div>
            <div class="tile-value">{fmt(s.total - s.mapped)}</div>
            <div class="tile-note">no usable location</div>
          </div>
        )}
      </div>

      <section class="card">
        <div class="card-head">
          <div>
            <h3>Offenses</h3>
            <p class="card-sub">Tap an offense to show only it; tap more to combine</p>
          </div>
        </div>
        {offenses.length === 0 ? (
          <p class="empty">No incidents match these filters.</p>
        ) : (
          <ul class="bars">
            {shown.map((o) => {
              const active = selected.has(o.id);
              const dim = selected.size > 0 && !active;
              return (
                <li key={o.id}>
                  <button class={`bar-row ${dim ? "bar-dim" : ""}`} aria-pressed={active} onClick={() => toggle(o.id)}>
                    <span class="bar-name">
                      {active && <CheckIcon size={14} />}
                      {o.name}
                    </span>
                    <span class="bar-value">{fmt(o.count)}</span>
                    <span class="bar-track">
                      <span class="bar-fill" style={{ width: `${top ? (o.count / top) * 100 : 0}%`, background: colors[o.group] }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {offenses.length > 8 && (
          <button class="link" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show fewer" : `Show all ${offenses.length} offenses`}
          </button>
        )}
      </section>

      <HourGrid />
    </>
  );
}
