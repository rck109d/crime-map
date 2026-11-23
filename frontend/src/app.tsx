import { useEffect, useRef, useState } from "preact/hooks";
import { formatRange } from "./data/dates";
import { mapApi, mapInsets, MapView } from "./map/MapView";
import {
  applied,
  busy,
  calendar,
  groupsOn,
  loadError,
  manifest,
  selection,
  summary,
  tab,
  theme,
  type Tab,
} from "./state";
import { GROUP_LABELS, GROUP_LONG_LABELS, GROUP_ORDER, THEMES } from "./theme";
import { About } from "./ui/About";
import { Areas } from "./ui/Areas";
import { FilterBar } from "./ui/FilterBar";
import { fmt, fmtCompact } from "./ui/format";
import { MenuIcon } from "./ui/icons";
import { MapTools } from "./ui/MapTools";
import { Overview } from "./ui/Overview";
import { SelectionHeader, SelectionList } from "./ui/SelectionList";
import { Sheet, sheetSnap, WIDE } from "./ui/Sheet";
import { TrendChart } from "./ui/TrendChart";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "areas", label: "Areas" },
];

function Legend() {
  const s = summary.value;
  const colors = THEMES[theme.value].groups;
  const on = groupsOn.value;
  return (
    <div class="group-legend" role="group" aria-label="Categories shown">
      {GROUP_ORDER.map((g) => (
        <button
          key={g}
          class="group-toggle"
          aria-pressed={on[g]}
          title={GROUP_LONG_LABELS[g]}
          onClick={() => (groupsOn.value = on.map((v, i) => (i === g ? !v : v)))}
        >
          <span class="dot" style={on[g] ? { background: colors[g] } : { boxShadow: `inset 0 0 0 2px ${colors[g]}` }} />
          <span class="group-name">{GROUP_LABELS[g]}</span>
          <span class="group-count">{s ? fmtCompact(s.byGroup[g]) : ""}</span>
        </button>
      ))}
    </div>
  );
}

function Headline() {
  const s = summary.value;
  const cal = calendar.value;
  const r = applied.value;
  return (
    <div class={`headline ${busy.value ? "stale" : ""}`}>
      <div class="headline-count">
        <strong>{s ? fmt(s.total) : "–"}</strong>
        <span>{s && s.total === 1 ? "incident" : "incidents"}</span>
      </div>
      <div class="headline-range">{cal && s ? formatRange(cal.date(r.d0), cal.date(r.d1)) : "Loading…"}</div>
    </div>
  );
}

export function App() {
  const [about, setAbout] = useState(false);
  const topRef = useRef<HTMLElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const [topInset, setTopInset] = useState(96);

  // Tell the map how much of it the page chrome covers.
  useEffect(() => {
    const app = appRef.current!;
    const measure = () => {
      const wide = matchMedia(WIDE).matches;
      const top = wide ? 0 : topRef.current!.offsetHeight;
      const sheet = app.querySelector<HTMLElement>(".sheet");
      const bottom = wide || !sheet ? 0 : Math.min(sheet.offsetHeight, innerHeight * 0.6);
      setTopInset(top);
      app.style.setProperty("--top-inset", `${top}px`);
      app.style.setProperty("--bottom-inset", `${bottom}px`);
      mapInsets.value = { top, bottom, left: 0, right: 0 };
    };
    const observer = new ResizeObserver(measure);
    observer.observe(topRef.current!);
    const sheet = app.querySelector(".sheet");
    if (sheet) observer.observe(sheet);
    addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      removeEventListener("resize", measure);
    };
  }, [manifest.value !== null]);

  // Opening an incident raises the sheet and keeps the spot in view above it.
  useEffect(() => {
    const sel = selection.value;
    if (!sel) return;
    if (sheetSnap.value === "peek") sheetSnap.value = "half";
    const timer = setTimeout(() => mapApi.reveal(sel.at), 320);
    return () => clearTimeout(timer);
  }, [selection.value]);

  const failed = loadError.value;
  return (
    <div class="app" ref={appRef}>
      <MapView />
      <div class="panel">
        <header class="topbar" ref={topRef}>
          <div class="title-row">
            <h1>Atlanta Crime Map</h1>
            <button class="icon-button" onClick={() => setAbout(true)} aria-label="About this map, appearance and export">
              <MenuIcon />
            </button>
          </div>
          <FilterBar />
          {busy.value && <div class="progress" role="progressbar" aria-label="Loading incidents" />}
        </header>
        {manifest.value && (
          <Sheet
            topInset={topInset}
            head={
              <>
                <Headline />
                <Legend />
                {selection.value ? (
                  <SelectionHeader />
                ) : (
                  <div class="tabs" role="tablist">
                    {TABS.map((t) => (
                      <button
                        key={t.id}
                        role="tab"
                        aria-selected={tab.value === t.id}
                        onClick={() => {
                          tab.value = t.id;
                          if (sheetSnap.value === "peek") sheetSnap.value = "half";
                        }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            }
          >
            {selection.value ? (
              <SelectionList />
            ) : (
              <div class={`tab-body ${busy.value ? "stale" : ""}`} role="tabpanel">
                {tab.value === "overview" && <Overview />}
                {tab.value === "trends" && <TrendChart />}
                {tab.value === "areas" && <Areas />}
              </div>
            )}
          </Sheet>
        )}
      </div>
      <MapTools />
      {failed && (
        <div class="notice" role="alert">
          <p>The incident data could not be loaded.</p>
          <p class="fine">{failed}</p>
          <button class="button" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      )}
      {!manifest.value && !failed && (
        <div class="notice notice-quiet" role="status">
          <p>Loading incidents…</p>
        </div>
      )}
      <About open={about} onClose={() => setAbout(false)} />
    </div>
  );
}
