import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { loadSearchIndex } from "../data/load";
import { displayName, searchAreas, searchPlaces, type Hit, type SearchIndex } from "../data/search";
import { mapApi } from "../map/MapView";
import { area, areaKind, geo, manifest } from "../state";
import { fmt } from "./format";
import { CloseIcon, SearchIcon } from "./icons";

const KIND_LABELS = { street: "Street", address: "Address", crossing: "Intersection" } as const;

/** The magnifying-glass button and the search panel it opens. */
export function Search() {
  const m = manifest.value;
  const g = geo.value;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = dialog.current!;
    if (open && !el.open) {
      el.showModal();
      input.current?.focus();
    }
    if (!open && el.open) el.close();
    // The index is only needed once someone searches, so it is fetched on first use.
    if (open && !index && m) {
      setFailed(false);
      loadSearchIndex(m).then(setIndex, () => setFailed(true));
    }
  }, [open]);

  const areas = useMemo(() => (m ? searchAreas(m, query) : []), [m, query]);
  const places = useMemo(() => (index ? searchPlaces(index, query) : null), [index, query]);
  const hits: Hit[] = [...areas, ...(places ? [...places.addresses, ...places.streets, ...places.crossings] : [])];
  const typed = query.trim().length > 0;

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const pick = (hit: Hit) => {
    close();
    if (!g) return;
    if (hit.kind === "area") {
      area.value = { kind: hit.areaKind, id: hit.id };
      areaKind.value = hit.areaKind;
      mapApi.fitVisible();
    } else if (hit.kind === "street") {
      const [minX, minY, maxX, maxY] = hit.box;
      mapApi.fitBox(g.lng(minX), g.lat(minY), g.lng(maxX), g.lat(maxY));
    } else {
      mapApi.showAddress([g.lng(hit.x), g.lat(hit.y)], hit.id, displayName(hit.label), hit.count);
    }
  };

  return (
    <>
      <button class="icon-button" onClick={() => setOpen(true)} aria-label="Search for a street, address or area">
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
        {open && (
          <form
            class="dialog-body"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (hits.length) pick(hits[0]);
            }}
          >
            <div class="search-bar">
              <SearchIcon />
              <input
                ref={input}
                type="search"
                enterkeyhint="search"
                autocomplete="off"
                autocorrect="off"
                spellcheck={false}
                placeholder="Street, address or neighborhood"
                aria-label="Search for a street, address or area"
                value={query}
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
              <button type="button" class="icon-button" onClick={close} aria-label="Close search">
                <CloseIcon size={18} />
              </button>
            </div>
            <div class="dialog-scroll search-results">
              {hits.length > 0 && (
                <ul class="rows">
                  {hits.map((hit, k) => (
                    <li key={`${hit.kind}:${hit.label}:${k}`}>
                      <button type="button" class="row" onClick={() => pick(hit)}>
                        <span class="row-main">{hit.kind === "area" ? hit.label : displayName(hit.label)}</span>
                        <span class="row-note">
                          {hit.kind === "area"
                            ? hit.note
                            : `${KIND_LABELS[hit.kind]} · ${fmt(hit.count)} ${hit.count === 1 ? "incident" : "incidents"}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {typed && hits.length === 0 && index && (
                <p class="empty">
                  Nothing found. Search covers neighborhoods and the streets and addresses that appear in incident
                  reports, not businesses or landmarks.
                </p>
              )}
              {typed && !index && !failed && <p class="fine">Loading streets and addresses…</p>}
              {failed && <p class="fine">Streets and addresses could not be loaded. Close search and try again.</p>}
              {!typed && (
                <p class="fine">
                  Try a street (“Ponce de Leon”), an address (“3393 Peachtree”), an intersection (“Peachtree 10th”) or a
                  neighborhood. Incident counts are for all dates since 2021.
                </p>
              )}
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
