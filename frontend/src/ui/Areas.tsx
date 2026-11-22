import { useState } from "preact/hooks";
import type { AreaKind } from "../data/filter";
import { mapApi } from "../map/MapView";
import { area, areaKind, manifest, summary, theme } from "../state";
import { THEMES } from "../theme";
import { fmt } from "./format";
import { CheckIcon } from "./icons";

const KINDS: { id: AreaKind; label: string }[] = [
  { id: "nhood", label: "Neighborhood" },
  { id: "npu", label: "NPU" },
  { id: "zone", label: "Police zone" },
];

export function Areas() {
  const s = summary.value;
  const m = manifest.value;
  const kind = areaKind.value;
  const [showAll, setShowAll] = useState(false);
  if (!s || !m) return null;
  const names = { nhood: m.nhoods, npu: m.npus, zone: m.zones }[kind];
  const counts = s.byArea[kind];
  const active = area.value?.kind === kind ? area.value.id : -1;
  const rows = names
    .map((name, id) => ({
      id,
      name: !name ? "Not recorded" : kind === "npu" ? `NPU ${name}` : name,
      count: counts[id],
    }))
    .filter((r) => r.count > 0 || r.id === active)
    .sort((a, b) => b.count - a.count);
  const top = rows[0]?.count ?? 0;
  const shown = showAll ? rows : rows.slice(0, 15);
  const fill = THEMES[theme.value].ramp[3];

  const pick = (id: number) => {
    if (id === active) {
      area.value = null;
      return;
    }
    area.value = { kind, id };
    mapApi.fitVisible();
  };

  return (
    <section class="card">
      <div class="card-head">
        <div>
          <h3>Where</h3>
          <p class="card-sub">Incidents by area. Tap one to filter the map to it.</p>
        </div>
      </div>
      <div class="segmented" role="group" aria-label="Area type">
        {KINDS.map((k) => (
          <button
            key={k.id}
            aria-pressed={kind === k.id}
            onClick={() => {
              areaKind.value = k.id;
              setShowAll(false);
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p class="empty">No incidents match these filters.</p>
      ) : (
        <ol class="bars">
          {shown.map((r) => (
            <li key={r.id}>
              <button
                class={`bar-row ${active >= 0 && r.id !== active ? "bar-dim" : ""}`}
                aria-pressed={r.id === active}
                onClick={() => pick(r.id)}
              >
                <span class="bar-name">
                  {r.id === active && <CheckIcon size={14} />}
                  {r.name}
                </span>
                <span class="bar-value">{fmt(r.count)}</span>
                <span class="bar-track">
                  <span class="bar-fill" style={{ width: `${top ? (r.count / top) * 100 : 0}%`, background: fill }} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 15 && (
        <button class="link" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}
