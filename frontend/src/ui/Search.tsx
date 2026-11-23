import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { loadSearchIndex } from "../data/load";
import { nominatimUrl, parseNominatim, parsePhoton, photonUrl, type PlaceHit } from "../data/places";
import { displayName, searchAreas, searchPlaces, type Hit, type SearchIndex } from "../data/search";
import { mapApi } from "../map/MapView";
import { area, areaKind, geo, manifest, polygon } from "../state";
import { areaLabel } from "./FilterBar";
import { fmt } from "./format";
import { CloseIcon, SearchIcon } from "./icons";

const KIND_LABELS = { street: "Street", address: "Address", crossing: "Intersection" } as const;

type Mode = "local" | "photon" | "nominatim";

/** Each way of searching: what it finds, and where what you type goes. */
const MODES: { id: Mode; label: string; privacy: string; finds: string; placeholder: string }[] = [
  {
    id: "local",
    label: "Local",
    privacy: "Private: stays on this device.",
    finds: "Finds streets, addresses and neighborhoods from APD’s reports.",
    placeholder: "Street, address or neighborhood",
  },
  {
    id: "photon",
    label: "Photon",
    privacy: "Sent to photon.komoot.io as you type.",
    finds: "Finds businesses, landmarks and other places.",
    placeholder: "Business, landmark or place",
  },
  {
    id: "nominatim",
    label: "Nominatim",
    privacy: "Sent to openstreetmap.org when you press Search.",
    finds: "Finds businesses, landmarks and other places.",
    placeholder: "Business, landmark or place",
  },
];

/** Shortest text worth sending to an outside service. */
const MIN_REMOTE_LENGTH = 3;
/** Pause in typing before Photon is asked, so it is not sent every keystroke. */
const TYPING_PAUSE_MS = 350;
/** Nominatim's usage policy allows at most one request a second. */
const NOMINATIM_INTERVAL_MS = 1100;

/** Results from an outside service. Earlier hits stay on screen while newer ones load. */
interface Remote {
  state: "idle" | "loading" | "done" | "error";
  /** The text the hits answer. */
  query: string;
  hits: PlaceHit[];
}
const NOTHING: Remote = { state: "idle", query: "", hits: [] };

/** A picked result waiting on the question of whether to drop location filters first. */
interface Pending {
  title: string;
  /** The active location filters, as they would be named in a sentence. */
  filters: string[];
  /** Whether removing filters should include the area filter. */
  dropArea: boolean;
  go: () => void;
}

function readMode(): Mode {
  try {
    const saved = localStorage.getItem("searchMode");
    return saved === "photon" || saved === "nominatim" ? saved : "local";
  } catch {
    return "local";
  }
}

/** The magnifying-glass button and the search panel it opens. */
export function Search() {
  const m = manifest.value;
  const g = geo.value;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(readMode);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [remote, setRemote] = useState<Remote>(NOTHING);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const lastNominatim = useRef(0);
  const shownMode = useRef<Mode>(mode);
  const info = MODES.find((x) => x.id === mode)!;
  const text = query.trim();

  useEffect(() => {
    const el = dialog.current!;
    if (open && !el.open) {
      el.showModal();
      input.current?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  // The local index is only needed once someone searches locally, so it is fetched on first use.
  useEffect(() => {
    if (open && mode === "local" && !index && m) {
      setFailed(false);
      loadSearchIndex(m).then(setIndex, () => setFailed(true));
    }
  }, [open, mode]);

  const ask = async (service: "photon" | "nominatim", wanted: string) => {
    if (!m) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRemote((previous) => ({ ...previous, state: "loading" }));
    try {
      const url = service === "photon" ? photonUrl(wanted, m.bbox) : nominatimUrl(wanted, m.bbox);
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const hits = service === "photon" ? parsePhoton(body, m.bbox) : parseNominatim(body, m.bbox);
      setRemote({ state: "done", query: wanted, hits });
    } catch (err) {
      if (!controller.signal.aborted) setRemote({ state: "error", query: wanted, hits: [] });
    }
  };

  // Photon searches as you type, after a short pause; that includes text already
  // in the box when its tab is chosen. Nominatim is never asked from here: its
  // results belong to the text that was searched, so editing clears them.
  useEffect(() => {
    request.current?.abort();
    const switched = shownMode.current !== mode;
    shownMode.current = mode;
    if (!open || mode !== "photon" || text.length < MIN_REMOTE_LENGTH) {
      setRemote(NOTHING);
      return;
    }
    // Results never carry over from one service to another, but while typing
    // within Photon the previous ones stay up until the next arrive.
    if (switched) setRemote(NOTHING);
    const timer = setTimeout(() => void ask("photon", text), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [open, mode, text]);

  const areas = useMemo(() => (m && mode === "local" ? searchAreas(m, query) : []), [m, mode, query]);
  const places = useMemo(
    () => (index && mode === "local" ? searchPlaces(index, query) : null),
    [index, mode, query],
  );
  const localHits: Hit[] = [...areas, ...(places ? [...places.addresses, ...places.streets, ...places.crossings] : [])];
  const remoteHits = remote.hits;

  const close = () => {
    request.current?.abort();
    setOpen(false);
    setQuery("");
    setPending(null);
  };

  /**
   * Go to a search result. A location filter left on would hide everything
   * outside it, so the place searched for could look empty; when one is
   * active, ask first whether to remove it.
   */
  const goTo = (title: string, replacesArea: boolean, go: () => void) => {
    const filters: string[] = [];
    // Picking a neighborhood replaces the area filter anyway, so that one is not asked about.
    if (area.value && !replacesArea) filters.push(areaLabel());
    if (polygon.value) filters.push("the area you drew");
    if (filters.length === 0) {
      close();
      go();
      return;
    }
    setPending({ title, filters, dropArea: !replacesArea, go });
  };

  const settle = (remove: boolean) => {
    if (!pending) return;
    const { go, dropArea } = pending;
    if (remove) {
      if (dropArea) area.value = null;
      polygon.value = null;
    }
    close();
    go();
  };

  const choose = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem("searchMode", next);
    } catch {
      // Storage can be unavailable; the choice then lasts until the page closes.
    }
    input.current?.focus();
  };

  const pick = (hit: Hit) => {
    if (!g) return;
    if (hit.kind === "area") {
      goTo(hit.label, true, () => {
        area.value = { kind: hit.areaKind, id: hit.id };
        areaKind.value = hit.areaKind;
        mapApi.fitArea(hit.areaKind, hit.id);
      });
    } else if (hit.kind === "street") {
      const [minX, minY, maxX, maxY] = hit.box;
      goTo(displayName(hit.label), false, () => mapApi.fitBox(g.lng(minX), g.lat(minY), g.lng(maxX), g.lat(maxY)));
    } else {
      const label = displayName(hit.label);
      goTo(label, false, () => mapApi.showAddress([g.lng(hit.x), g.lat(hit.y)], hit.id, label, hit.count));
    }
  };

  const pickPlace = (hit: PlaceHit) => {
    goTo(hit.label, false, () => mapApi.showPlace([hit.lng, hit.lat], hit.label));
  };

  const submit = () => {
    if (mode === "local") {
      if (localHits.length) pick(localHits[0]);
    } else if (mode === "photon") {
      if (remoteHits.length) pickPlace(remoteHits[0]);
    } else if (text.length >= MIN_REMOTE_LENGTH && remote.state !== "loading") {
      // Keep to Nominatim's one-request-a-second limit even if Search is pressed repeatedly.
      const wait = Math.max(0, lastNominatim.current + NOMINATIM_INTERVAL_MS - Date.now());
      lastNominatim.current = Date.now() + wait;
      setRemote((previous) => ({ ...previous, state: "loading" }));
      setTimeout(() => void ask("nominatim", text), wait);
    }
  };

  return (
    <>
      <button class="icon-button" onClick={() => setOpen(true)} aria-label="Search the map">
        <SearchIcon />
      </button>
      <dialog
        ref={dialog}
        class="dialog dialog-top"
        onClose={close}
        onClick={(e) => {
          if (e.target === dialog.current) close(); // click on the backdrop
        }}
      >
        {open && pending && (
          <div class="dialog-body search-confirm" role="alertdialog" aria-labelledby="search-confirm-title">
            <h2 id="search-confirm-title">
              Remove {pending.filters.length > 1 ? "your location filters" : "your location filter"}?
            </h2>
            <p>
              The map is limited to <strong>{pending.filters.join(" and ")}</strong>. If that stays on, only incidents
              inside {pending.filters.length > 1 ? "them" : "it"} will show when you go to{" "}
              <strong>{pending.title}</strong>.
            </p>
            <div class="button-row">
              <button type="button" class="button" autofocus onClick={() => settle(true)}>
                Remove and go
              </button>
              <button type="button" class="button button-quiet" onClick={() => settle(false)}>
                Keep and go
              </button>
              <button type="button" class="button button-quiet" onClick={() => setPending(null)}>
                Back
              </button>
            </div>
          </div>
        )}
        {open && !pending && (
          <form
            class="dialog-body"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div class="search-top">
              <div class="search-tabs" role="tablist" aria-label="Where to search">
                {MODES.map((x) => (
                  <button key={x.id} type="button" role="tab" aria-selected={mode === x.id} onClick={() => choose(x.id)}>
                    {x.label}
                  </button>
                ))}
              </div>
              <button type="button" class="icon-button" onClick={close} aria-label="Close search">
                <CloseIcon size={18} />
              </button>
            </div>
            <p class={`search-about ${mode === "local" ? "search-private" : "search-shared"}`}>
              <strong>{info.privacy}</strong> {info.finds}
            </p>
            <div class="search-bar">
              <SearchIcon />
              <input
                ref={input}
                type="search"
                enterkeyhint="search"
                autocomplete="off"
                autocorrect="off"
                spellcheck={false}
                placeholder={info.placeholder}
                aria-label={`Search: ${info.placeholder.toLowerCase()}`}
                value={query}
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
              {mode === "nominatim" && (
                <button class="button search-go" type="submit" disabled={text.length < MIN_REMOTE_LENGTH || remote.state === "loading"}>
                  Search
                </button>
              )}
            </div>
            <div class="dialog-scroll search-results">
              {mode === "local" ? (
                <>
                  {localHits.length > 0 && (
                    <ul class="rows">
                      {localHits.map((hit, k) => (
                        <li key={`${hit.kind}:${hit.label}:${k}`}>
                          <button type="button" class="row" onClick={() => pick(hit)}>
                            <span class="row-main">{hit.kind === "area" ? hit.label : displayName(hit.label)}</span>
                            <span class="row-note">
                              {hit.kind === "area"
                                ? hit.note
                                : `${hit.kind === "crossing" && !hit.label.includes("/") ? "Location" : KIND_LABELS[hit.kind]} · ${fmt(hit.count)} ${hit.count === 1 ? "incident" : "incidents"}`}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {text && localHits.length === 0 && index && (
                    <p class="empty">
                      Nothing found. Local search covers neighborhoods and the streets and addresses that appear in
                      incident reports. For a business or landmark, try the Photon or Nominatim tab.
                    </p>
                  )}
                  {text && !index && !failed && <p class="fine">Loading streets and addresses…</p>}
                  {failed && <p class="fine">Streets and addresses could not be loaded. Close search and try again.</p>}
                  {!text && (
                    <p class="fine">
                      Try a street (“Ponce de Leon”), an address (“3393 Peachtree”), an intersection (“Peachtree 10th”)
                      or a neighborhood. Incident counts are for all dates since 2021.
                    </p>
                  )}
                </>
              ) : (
                <>
                  {remoteHits.length > 0 && (
                    <ul class={`rows ${remote.state === "loading" ? "stale" : ""}`}>
                      {remoteHits.map((hit, k) => (
                        <li key={`${hit.label}:${hit.lng}:${hit.lat}:${k}`}>
                          <button type="button" class="row" onClick={() => pickPlace(hit)}>
                            <span class="row-main">{hit.label}</span>
                            <span class="row-note">{hit.note}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {remote.state === "loading" && remoteHits.length === 0 && <p class="fine">Searching…</p>}
                  {remote.state === "done" && remoteHits.length === 0 && (
                    <p class="empty">No places found for “{remote.query}” in the Atlanta area.</p>
                  )}
                  {remote.state === "error" && (
                    <p class="empty">
                      {info.label} could not be reached. Try again, or use another tab; Local search does not need a
                      connection to it.
                    </p>
                  )}
                  {remote.state === "idle" && (
                    <p class="fine">
                      {mode === "photon"
                        ? `Type at least ${MIN_REMOTE_LENGTH} letters, such as “Piedmont Park” or “Lenox Square”. Whatever is in the box on this tab is sent to Photon.`
                        : "Type a place, such as “Piedmont Park” or “Lenox Square”, then press Search. Nothing is sent until you do."}{" "}
                      Picking a result shows incidents within 100 m of it.
                    </p>
                  )}
                  <p class="fine search-credit">
                    Place data ©{" "}
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
                      OpenStreetMap
                    </a>{" "}
                    contributors.
                  </p>
                </>
              )}
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
