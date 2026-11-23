import type { Signal } from "@preact/signals";
import { useMemo, useState } from "preact/hooks";
import { formatLong, formatRange } from "../data/dates";
import { displayName } from "../data/search";
import {
  activeFilterCount,
  applied,
  area,
  calendar,
  clearFilters,
  familyOnly,
  firearmOnly,
  groupsOn,
  lastDay,
  manifest,
  offenseSel,
  part1Only,
  polygon,
  PRESETS,
  requested,
  resolvePreset,
  setRange,
  street,
  summary,
  theme,
} from "../state";
import { GROUP_LONG_LABELS, GROUP_ORDER, THEMES } from "../theme";
import { Dialog } from "./Dialog";
import { fmt } from "./format";
import { CalendarIcon, CheckIcon, ChevronDown, CloseIcon } from "./icons";

export function rangeLabel(): string {
  const r = requested.value;
  const cal = calendar.value;
  if (r.preset !== "custom") return PRESETS.find((p) => p.id === r.preset)!.label;
  return cal ? formatRange(cal.date(r.d0), cal.date(r.d1)) : "";
}

export function areaLabel(): string {
  const a = area.value;
  const m = manifest.value;
  if (!a || !m) return "";
  const name = { nhood: m.nhoods, npu: m.npus, zone: m.zones }[a.kind][a.id];
  if (!name) return "Area not recorded";
  return a.kind === "npu" ? `NPU ${name}` : name;
}

export function FilterBar() {
  const [dialog, setDialog] = useState<"date" | "offense" | null>(null);
  const m = manifest.value;
  const sel = offenseSel.value;
  const offenseLabel =
    sel.length === 0 ? "All offenses" : sel.length === 1 && m ? m.offenses[sel[0]].name : `${sel.length} offenses`;
  return (
    <div class="filters" role="group" aria-label="Filters">
      <button class="chip" onClick={() => setDialog("date")} aria-haspopup="dialog">
        <CalendarIcon />
        <span>{rangeLabel()}</span>
        <ChevronDown />
      </button>
      {area.value && (
        <button class="chip chip-on" onClick={() => (area.value = null)} aria-label={`Remove area filter: ${areaLabel()}`}>
          <span class="chip-text">{areaLabel()}</span>
          <CloseIcon size={14} />
        </button>
      )}
      {street.value && (
        <button
          class="chip chip-on"
          onClick={() => (street.value = null)}
          aria-label={`Remove street filter: ${displayName(street.value.name)}`}
        >
          <span class="chip-text">{displayName(street.value.name)}</span>
          <CloseIcon size={14} />
        </button>
      )}
      {polygon.value && (
        <button class="chip chip-on" onClick={() => (polygon.value = null)} aria-label="Remove drawn area">
          <span>Drawn area</span>
          <CloseIcon size={14} />
        </button>
      )}
      <button
        class={`chip ${sel.length ? "chip-on" : ""}`}
        onClick={() => setDialog("offense")}
        aria-haspopup="dialog"
      >
        <span class="chip-text">{offenseLabel}</span>
        <ChevronDown />
      </button>
      <Toggle
        label="Part I only"
        title="Offenses APD marks as UCR Part I: homicide, rape, robbery, aggravated assault, burglary, theft, motor vehicle theft, arson and human trafficking"
        state={part1Only}
      />
      <Toggle label="Firearm involved" state={firearmOnly} />
      <Toggle label="Family violence" title="Flagged by APD as family violence under Georgia law" state={familyOnly} />
      {activeFilterCount.value > 0 && (
        <button class="chip chip-ghost" onClick={clearFilters}>
          Clear all
        </button>
      )}
      <DateDialog open={dialog === "date"} onClose={() => setDialog(null)} />
      <OffenseDialog open={dialog === "offense"} onClose={() => setDialog(null)} />
    </div>
  );
}

function Toggle({ label, title, state }: { label: string; title?: string; state: Signal<boolean> }) {
  return (
    <button
      class={`chip ${state.value ? "chip-on" : ""}`}
      aria-pressed={state.value}
      title={title}
      onClick={() => (state.value = !state.value)}
    >
      {state.value && <CheckIcon size={14} />}
      <span>{label}</span>
    </button>
  );
}

function DateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cal = calendar.value;
  const r = requested.value;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  if (!cal) return null;
  const min = cal.iso(0);
  const max = cal.iso(lastDay.value);
  const fromValue = from || cal.iso(r.d0);
  const toValue = to || cal.iso(r.d1);
  // A typed date can still be out of range, so check as well as constrain.
  const inData = (v: string) => v.length === 10 && v >= min && v <= max;
  const valid = inData(fromValue) && inData(toValue) && fromValue <= toValue;
  const dataSpan = `${formatLong(cal.date(0))} and ${formatLong(cal.date(lastDay.value))}`;
  const problem = valid
    ? null
    : inData(fromValue) && inData(toValue)
      ? "The end date is before the start date."
      : `Choose dates between ${dataSpan}; there is no data outside that.`;
  const close = () => {
    setFrom("");
    setTo("");
    onClose();
  };
  return (
    <Dialog title="Date range" open={open} onClose={close}>
      <ul class="rows" role="listbox" aria-label="Preset ranges">
        {PRESETS.map((p) => {
          const active = r.preset === p.id;
          const span = resolvePreset(p.id);
          return (
            <li key={p.id}>
              <button
                class="row"
                role="option"
                aria-selected={active}
                onClick={() => {
                  void setRange(span);
                  close();
                }}
              >
                <span class="row-main">{p.label}</span>
                <span class="row-note">{formatRange(cal.date(Math.max(0, span.d0)), cal.date(span.d1))}</span>
                <span class="row-check">{active && <CheckIcon />}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <form
        class="custom-range"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          void setRange({ preset: "custom", d0: cal.dayOf(fromValue), d1: cal.dayOf(toValue) });
          close();
        }}
      >
        <div class="custom-title">
          Custom range {r.preset === "custom" && <CheckIcon />}
        </div>
        {/* The pickers offer only days that have data, and no end date before the start. */}
        <label>
          <span>From</span>
          <input
            type="date"
            min={min}
            max={max}
            value={fromValue}
            aria-invalid={!inData(fromValue)}
            onInput={(e) => {
              const v = e.currentTarget.value;
              setFrom(v);
              // Moving the start past the end carries the end along with it.
              if (inData(v) && v > toValue) setTo(v);
            }}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="date"
            min={inData(fromValue) ? fromValue : min}
            max={max}
            value={toValue}
            aria-invalid={!inData(toValue) || toValue < fromValue}
            onInput={(e) => setTo(e.currentTarget.value)}
          />
        </label>
        {problem && (
          <p class="field-error" role="alert">
            {problem}
          </p>
        )}
        <button class="button" type="submit" disabled={!valid}>
          Apply
        </button>
      </form>
      <p class="fine">Dates are when an incident was reported. Data runs {formatRange(cal.date(0), cal.date(lastDay.value))}.</p>
    </Dialog>
  );
}

function OffenseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = manifest.value;
  const s = summary.value;
  const [query, setQuery] = useState("");
  const sel = new Set(offenseSel.value);
  const colors = THEMES[theme.value].groups;
  const groups = useMemo(() => {
    if (!m) return [];
    const q = query.trim().toLowerCase();
    return m.groups.map((_, g) =>
      m.offenses
        .map((info, id) => ({ ...info, id, count: s ? s.byOffense[id] : 0 }))
        .filter((o) => o.group === g && (!q || o.name.toLowerCase().includes(q)))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    );
  }, [m, s, query]);
  if (!m) return null;
  const toggle = (id: number) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    offenseSel.value = [...next].sort((a, b) => a - b);
  };
  return (
    <Dialog
      title="Offenses"
      open={open}
      onClose={() => {
        setQuery("");
        onClose();
      }}
      footer={
        <>
          <button class="button button-quiet" disabled={sel.size === 0} onClick={() => (offenseSel.value = [])}>
            Show all offenses
          </button>
          <button class="button" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <input
        class="search"
        type="search"
        placeholder="Search offenses"
        aria-label="Search offenses"
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
      />
      {GROUP_ORDER.map((g) => [g, groups[g] ?? []] as const).map(([g, list]) =>
        list.length === 0 ? null : (
          <section key={g}>
            <h3 class="list-head">
              <span class="dot" style={{ background: colors[g] }} />
              {GROUP_LONG_LABELS[g]}
              {!groupsOn.value[g] && <span class="fine"> · switched off</span>}
            </h3>
            <ul class="rows">
              {list.map((o) => (
                <li key={o.id}>
                  <label class="row">
                    <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} />
                    <span class="row-main">
                      {o.name}
                      {o.part1 && <span class="tag">Part I</span>}
                    </span>
                    <span class="row-count">{fmt(o.count)}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
      <p class="fine">
        “Part I” marks the offenses the Part I only filter keeps. Counts are for {rangeLabel().toLowerCase()}
        {applied.value !== requested.value ? " (loading…)" : ""} with your other filters applied.
      </p>
    </Dialog>
  );
}
