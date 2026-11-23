import { computed, effect, signal } from "@preact/signals";
import { makeCalendar, type Calendar } from "./data/dates";
import { summarize, type AreaKind, type Filters, type Summary } from "./data/filter";
import { combineYears } from "./data/format";
import { makeGeo, type Geo } from "./data/geo";
import { loadManifest, loadYear } from "./data/load";
import {
  FLAG_FAMILY,
  FLAG_FIREARM,
  FLAG_PART1,
  GROUP_COUNT,
  type Manifest,
  type PointColumns,
  type Points,
} from "./data/types";
import type { ThemeName } from "./theme";

export type Preset = "7d" | "30d" | "90d" | "ytd" | "1y" | "all" | "custom";
export interface DayRange {
  preset: Preset;
  d0: number;
  d1: number;
}
export type MapMode = "points" | "density";
export type Tab = "overview" | "trends" | "areas";
export type ThemePref = "auto" | ThemeName;
export type LngLat = [number, number];

export interface Selection {
  rows: number[];
  /** "spot": everything within reach of a tap. "cell": one density hexagon. */
  kind: "spot" | "cell";
  /** Outline of the area the rows were taken from. */
  ring: LngLat[];
  /** A point inside it, for keeping it in view. */
  at: LngLat;
}

export const PRESETS: { id: Exclude<Preset, "custom">; label: string }[] = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "ytd", label: "This year" },
  { id: "1y", label: "Last 12 months" },
  { id: "all", label: "All data" },
];

// --- loaded data -----------------------------------------------------------
export const manifest = signal<Manifest | null>(null);
export const points = signal<Points | null>(null);
export const loadError = signal<string | null>(null);
/** True while the files for a newly requested date range are downloading. */
export const busy = signal(false);

export const calendar = computed<Calendar | null>(() =>
  manifest.value ? makeCalendar(manifest.value.epoch) : null,
);
export const geo = computed<Geo | null>(() => (manifest.value ? makeGeo(manifest.value) : null));
export const lastDay = computed(() =>
  manifest.value && calendar.value ? calendar.value.dayOf(manifest.value.through) : 0,
);

// --- filters ---------------------------------------------------------------
/** What the user asked for; `applied` follows once its data has loaded. */
export const requested = signal<DayRange>({ preset: "90d", d0: 0, d1: 0 });
export const applied = signal<DayRange>({ preset: "90d", d0: 0, d1: 0 });
export const groupsOn = signal<boolean[]>(Array(GROUP_COUNT).fill(true));
export const offenseSel = signal<number[]>([]);
export const area = signal<{ kind: AreaKind; id: number } | null>(null);
export const polygon = signal<LngLat[] | null>(null);
export const firearmOnly = signal(false);
export const familyOnly = signal(false);
/** UCR Part I offenses only: one switch standing in for a fixed list of serious offenses. */
export const part1Only = signal(false);

// --- view ------------------------------------------------------------------
export const mode = signal<MapMode>("points");
export const tab = signal<Tab>("overview");
export const areaKind = signal<AreaKind>("nhood");
/** Smoothing radius in days; -1 picks one to suit the range length. */
export const smoothing = signal(-1);
export const selection = signal<Selection | null>(null);
/** Vertices of an area being drawn, or null when not drawing. */
export const drawing = signal<LngLat[] | null>(null);
export const themePref = signal<ThemePref>(readPref());
const systemDark = signal(matchDark()?.matches ?? false);
export const theme = computed<ThemeName>(() =>
  themePref.value === "auto" ? (systemDark.value ? "dark" : "light") : themePref.value,
);
/** Map position; the starting value comes straight from the URL so the map can open there. */
export const mapView = signal<{ lng: number; lat: number; zoom: number } | null>(readView());

function readView() {
  const v = new URLSearchParams(location.hash.slice(1)).get("v")?.split(",").map(Number);
  return v && v.length === 3 && v.every(Number.isFinite) ? { lat: v[0], lng: v[1], zoom: v[2] } : null;
}

function matchDark() {
  return typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
}
matchDark()?.addEventListener("change", (e) => (systemDark.value = e.matches));

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}
export function setThemePref(pref: ThemePref) {
  themePref.value = pref;
  try {
    if (pref === "auto") localStorage.removeItem("theme");
    else localStorage.setItem("theme", pref);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this visit.
  }
}

// --- derived ---------------------------------------------------------------
export const filters = computed<Filters | null>(() => {
  const g = geo.value;
  if (!g) return null;
  const sel = offenseSel.value;
  const poly = polygon.value;
  return {
    d0: applied.value.d0,
    d1: applied.value.d1,
    groups: groupsOn.value,
    offenses: sel.length ? new Set(sel) : null,
    area: area.value,
    polygon: poly ? poly.map(([lng, lat]) => [g.x(lng), g.y(lat)] as const) : null,
    requireFlags:
      (firearmOnly.value ? FLAG_FIREARM : 0) |
      (familyOnly.value ? FLAG_FAMILY : 0) |
      (part1Only.value ? FLAG_PART1 : 0),
  };
});

export const summary = computed<Summary | null>(() => {
  const m = manifest.value;
  const p = points.value;
  const f = filters.value;
  if (!m || !p || !f) return null;
  return summarize(p, f, {
    offenses: m.offenses.length,
    nhoods: m.nhoods.length,
    npus: m.npus.length,
    zones: m.zones.length,
  });
});

/** Radius actually used for the trend chart. */
export const smoothingRadius = computed(() => {
  if (smoothing.value >= 0) return smoothing.value;
  const days = applied.value.d1 - applied.value.d0 + 1;
  return days <= 31 ? 0 : days <= 200 ? 3 : days <= 800 ? 7 : 30;
});

export const activeFilterCount = computed(
  () =>
    (offenseSel.value.length ? 1 : 0) +
    (area.value ? 1 : 0) +
    (polygon.value ? 1 : 0) +
    (firearmOnly.value ? 1 : 0) +
    (familyOnly.value ? 1 : 0) +
    (part1Only.value ? 1 : 0) +
    (groupsOn.value.every(Boolean) ? 0 : 1),
);

export function clearFilters() {
  offenseSel.value = [];
  area.value = null;
  polygon.value = null;
  firearmOnly.value = false;
  familyOnly.value = false;
  part1Only.value = false;
  groupsOn.value = Array(GROUP_COUNT).fill(true);
}

// A selection points at rows of the current table under the current filters.
effect(() => {
  summary.value;
  selection.value = null;
});

// --- date range ------------------------------------------------------------
export function resolvePreset(preset: Exclude<Preset, "custom">): DayRange {
  const end = lastDay.value;
  const cal = calendar.value!;
  switch (preset) {
    case "7d":
      return { preset, d0: end - 6, d1: end };
    case "30d":
      return { preset, d0: end - 29, d1: end };
    case "90d":
      return { preset, d0: end - 89, d1: end };
    case "ytd":
      return { preset, d0: cal.dayOf(`${cal.year(end)}-01-01`), d1: end };
    case "1y":
      return { preset, d0: end - 364, d1: end };
    case "all":
      return { preset, d0: 0, d1: end };
  }
}

const yearCache = new Map<number, PointColumns>();
let loadToken = 0;

export async function setRange(range: DayRange) {
  const m = manifest.value;
  const cal = calendar.value;
  if (!m || !cal || !Number.isFinite(range.d0) || !Number.isFinite(range.d1)) return;
  const d1 = Math.min(Math.max(range.d1, 0), lastDay.value);
  const d0 = Math.min(Math.max(range.d0, 0), d1);
  const next = { preset: range.preset, d0, d1 };
  requested.value = next;

  const available = new Set(m.years.map((y) => y.year));
  const needed: number[] = [];
  for (let y = cal.year(d0); y <= cal.year(d1); y++) if (available.has(y)) needed.push(y);
  const missing = needed.filter((y) => !yearCache.has(y));
  const token = ++loadToken;
  if (missing.length) {
    busy.value = true;
    try {
      const loaded = await Promise.all(missing.map((y) => loadYear(m, y)));
      missing.forEach((y, i) => yearCache.set(y, loaded[i]));
    } catch (err) {
      if (token === loadToken) {
        busy.value = false;
        loadError.value = err instanceof Error ? err.message : String(err);
      }
      return;
    }
    if (token !== loadToken) return; // a newer request superseded this one
    points.value = combineYears(m, yearCache);
  }
  loadError.value = null;
  busy.value = false;
  applied.value = next;
}

export async function start() {
  try {
    manifest.value = await loadManifest();
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
    return;
  }
  const fromUrl = readUrl();
  const valid = fromUrl && Number.isFinite(fromUrl.d0) && Number.isFinite(fromUrl.d1);
  await setRange(valid ? fromUrl : resolvePreset("90d"));
  urlReady = true;
}

// --- shareable URL ---------------------------------------------------------
let urlReady = false;

function readUrl(): DayRange | null {
  const m = manifest.value!;
  const cal = calendar.value!;
  const q = new URLSearchParams(location.hash.slice(1));
  const g = q.get("g");
  if (g && /^[01]{4}$/.test(g)) groupsOn.value = [...g].map((c) => c === "1");
  const o = q.get("o");
  if (o) {
    const codes = new Set(o.split(","));
    offenseSel.value = m.offenses.flatMap((info, i) => (codes.has(info.code) ? [i] : []));
  }
  const a = q.get("a");
  if (a) {
    const [kind, ...rest] = a.split(":");
    const lists = { nhood: m.nhoods, npu: m.npus, zone: m.zones };
    if (kind === "nhood" || kind === "npu" || kind === "zone") {
      const id = lists[kind].indexOf(rest.join(":"));
      if (id >= 0) {
        area.value = { kind, id };
        areaKind.value = kind;
      }
    }
  }
  const p = q.get("p");
  if (p) {
    const ring = p.split(";").map((pair) => pair.split(",").map(Number) as LngLat);
    if (ring.length >= 3 && ring.every((c) => c.length === 2 && c.every(Number.isFinite))) {
      polygon.value = ring;
    }
  }
  if (q.get("f") === "1") firearmOnly.value = true;
  if (q.get("fv") === "1") familyOnly.value = true;
  if (q.get("p1") === "1") part1Only.value = true;
  if (q.get("m") === "density") mode.value = "density";
  const t = q.get("t");
  if (t === "trends" || t === "areas") tab.value = t;
  const r = q.get("r");
  if (r) {
    const preset = PRESETS.find((x) => x.id === r);
    if (preset) return resolvePreset(preset.id);
    const m2 = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(r);
    if (m2) return { preset: "custom", d0: cal.dayOf(m2[1]), d1: cal.dayOf(m2[2]) };
  }
  return null;
}

effect(() => {
  const m = manifest.value;
  const cal = calendar.value;
  // Read every signal the URL reflects, so changes to any of them re-run this.
  const r = applied.value;
  const state = {
    g: groupsOn.value,
    o: offenseSel.value,
    a: area.value,
    p: polygon.value,
    f: firearmOnly.value,
    fv: familyOnly.value,
    p1: part1Only.value,
    m: mode.value,
    t: tab.value,
    v: mapView.value,
  };
  if (!urlReady || !m || !cal) return;
  const q = new URLSearchParams();
  q.set("r", r.preset === "custom" ? `${cal.iso(r.d0)}_${cal.iso(r.d1)}` : r.preset);
  if (!state.g.every(Boolean)) q.set("g", state.g.map((b) => (b ? "1" : "0")).join(""));
  if (state.o.length) q.set("o", state.o.map((i) => m.offenses[i].code).join(","));
  if (state.a) {
    const lists = { nhood: m.nhoods, npu: m.npus, zone: m.zones };
    q.set("a", `${state.a.kind}:${lists[state.a.kind][state.a.id]}`);
  }
  if (state.p) q.set("p", state.p.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(";"));
  if (state.f) q.set("f", "1");
  if (state.fv) q.set("fv", "1");
  if (state.p1) q.set("p1", "1");
  if (state.m !== "points") q.set("m", state.m);
  if (state.t !== "overview") q.set("t", state.t);
  if (state.v) {
    q.set("v", `${state.v.lat.toFixed(4)},${state.v.lng.toFixed(4)},${state.v.zoom.toFixed(2)}`);
  }
  // Keep the hash readable: these characters are safe unescaped in a fragment.
  const hash = q.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%3B/g, ";");
  history.replaceState(null, "", `#${hash}`);
});
