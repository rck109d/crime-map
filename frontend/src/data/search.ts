/**
 * Search over the areas in the manifest and the street index built from the
 * archive (search.json). Everything runs in the browser; nothing typed here
 * leaves it.
 */
import type { AreaKind } from "./filter";
import { convexHull, type XY } from "./hull";

export interface StreetEntry {
  /** Street name as APD writes it, e.g. "PEACHTREE RD NE". */
  n: string;
  /** Incidents on the street since the data begins. */
  c: number;
  /** Flat [house number, x, y, incidents, address id, ...], sorted by house number. */
  a: number[];
}

export interface SearchIndex {
  streets: StreetEntry[];
  /** [text, x, y, incidents, address id]: intersections and other addresses without a number. */
  crossings: [string, number, number, number, number][];
}

export interface AreaLists {
  nhoods: string[];
  npus: string[];
  zones: string[];
}

export type Hit =
  | { kind: "area"; areaKind: AreaKind; id: number; label: string; note: string }
  | { kind: "street"; label: string; count: number; box: [number, number, number, number] }
  | { kind: "address"; label: string; count: number; x: number; y: number; id: number }
  | { kind: "crossing"; label: string; count: number; x: number; y: number; id: number };

/** Values stored per address in StreetEntry.a. */
const STRIDE = 5;

/** Spelled-out words people type, mapped to the abbreviations in the data. */
const ABBREVIATIONS: Record<string, string> = {
  STREET: "ST",
  ROAD: "RD",
  AVENUE: "AVE",
  DRIVE: "DR",
  BOULEVARD: "BLVD",
  PARKWAY: "PKWY",
  PLACE: "PL",
  LANE: "LN",
  COURT: "CT",
  CIRCLE: "CIR",
  TERRACE: "TER",
  HIGHWAY: "HWY",
  EXPRESSWAY: "EXPY",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
  MLK: "MARTIN",
};
const IGNORED = new Set(["AND", "AT", "&", "/"]);

/** Upper-case words of a query, without punctuation or filler. */
export function tokenize(query: string): string[] {
  return query
    .toUpperCase()
    .replace(/[.,#]/g, " ")
    .split(/[\s/&]+/)
    .filter((word) => word && !IGNORED.has(word))
    .map((word) => ABBREVIATIONS[word] ?? word);
}

/** Every token starts some word of `text`. */
function matches(text: string, tokens: string[]): boolean {
  const words = text.toUpperCase().split(/[\s/()-]+/);
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

/** Lower is better: names beginning with the query come first. */
function rank(text: string, tokens: string[]): number {
  return text.toUpperCase().startsWith(tokens.join(" ")) ? 0 : 1;
}

export function searchAreas(areas: AreaLists, query: string, limit = 5): Hit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const hits: (Hit & { order: number })[] = [];
  const add = (areaKind: AreaKind, names: string[], note: string, show: (name: string) => string) => {
    names.forEach((name, id) => {
      if (!name) return;
      const label = show(name);
      if (matches(label, tokens)) hits.push({ kind: "area", areaKind, id, label, note, order: rank(label, tokens) });
    });
  };
  add("nhood", areas.nhoods, "Neighborhood", (n) => n);
  add("zone", areas.zones, "Police zone", (n) => n);
  add("npu", areas.npus, "Neighborhood planning unit", (n) => `NPU ${n}`);
  hits.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  return hits.slice(0, limit).map(({ order: _order, ...hit }) => hit);
}

function streetBox(street: StreetEntry): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < street.a.length; i += STRIDE) {
    const x = street.a[i + 1];
    const y = street.a[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export interface PlaceResults {
  addresses: Hit[];
  streets: Hit[];
  crossings: Hit[];
}

/** Streets, addresses ("3393 peachtree") and intersections matching a query. */
export function searchPlaces(index: SearchIndex, query: string, limit = 6): PlaceResults {
  const tokens = tokenize(query);
  const out: PlaceResults = { addresses: [], streets: [], crossings: [] };
  if (tokens.length === 0) return out;

  // A leading number is a house number: look for it on the streets named after it.
  if (/^\d+$/.test(tokens[0])) {
    const wanted = tokens[0];
    const rest = tokens.slice(1);
    type AddressHit = Extract<Hit, { kind: "address" }>;
    const exact: AddressHit[] = [];
    const partial: AddressHit[] = [];
    for (const street of index.streets) {
      if (rest.length && !matches(street.n, rest)) continue;
      for (let i = 0; i < street.a.length; i += STRIDE) {
        const number = String(street.a[i]);
        // With no street named, only the exact number: "33" alone should not list 3300-3399 everywhere.
        if (rest.length ? !number.startsWith(wanted) : number !== wanted) continue;
        const hit: AddressHit = {
          kind: "address",
          label: `${number} ${street.n}`,
          count: street.a[i + 3],
          x: street.a[i + 1],
          y: street.a[i + 2],
          id: street.a[i + 4],
        };
        (number === wanted ? exact : partial).push(hit);
      }
      if (exact.length >= limit) break;
    }
    // Streets are ordered busiest first, so results are too; exact numbers lead.
    out.addresses = [...exact, ...partial.sort((a, b) => b.count - a.count)].slice(0, limit);
  }

  // Too short to mean a street; a lone "1" would otherwise match every numbered one.
  const meaningful = tokens.some((t) => t.length >= 2);
  if (!meaningful) return out;

  const streets: { street: StreetEntry; order: number }[] = [];
  for (const street of index.streets) {
    if (matches(street.n, tokens)) streets.push({ street, order: rank(street.n, tokens) });
  }
  streets.sort((a, b) => a.order - b.order || b.street.c - a.street.c);
  out.streets = streets.slice(0, limit).map(({ street }) => ({
    kind: "street",
    label: street.n,
    count: street.c,
    box: streetBox(street),
  }));

  for (const [text, x, y, count, id] of index.crossings) {
    if (!matches(text, tokens)) continue;
    out.crossings.push({ kind: "crossing", label: text, count, x, y, id });
    if (out.crossings.length >= limit) break;
  }
  return out;
}

const KEEP_UPPER = new Set(["NE", "NW", "SE", "SW", "N", "S", "E", "W", "NB", "SB", "EB", "WB", "I", "US", "GA", "MLK"]);

/** "PEACHTREE RD NE / 10TH ST NE" -> "Peachtree Rd NE / 10th St NE" */
export function displayName(text: string): string {
  return text
    .split(" ")
    .map((word) => {
      if (KEEP_UPPER.has(word) || /^I-\d+$/.test(word)) return word;
      if (/^\d/.test(word)) return word.toLowerCase();
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Everything needed to filter the map to one street and show where it is. */
export interface StreetFilter {
  /** Street name as APD writes it, e.g. "PEACHTREE RD NE". */
  name: string;
  /** Ids of every address on the street, and of intersections that name it. */
  ids: number[];
  /** Outline around those addresses (quantized), computed here from their positions. */
  ring: XY[];
  /** [minX, minY, maxX, maxY] of the same positions. */
  box: [number, number, number, number];
}

/**
 * Work out a street's filter from the index: no extra data is stored per
 * street, the address ids and positions it already lists are enough.
 */
export function streetFilter(index: SearchIndex, name: string): StreetFilter | null {
  const street = index.streets.find((s) => s.n === name);
  if (!street) return null;
  const ids: number[] = [];
  const positions: XY[] = [];
  for (let i = 0; i < street.a.length; i += STRIDE) {
    positions.push([street.a[i + 1], street.a[i + 2]]);
    ids.push(street.a[i + 4]);
  }
  // "PEACHTREE ST NE / 10TH ST NE" belongs to both of its streets.
  for (const [text, x, y, , id] of index.crossings) {
    if (text.split("/").some((part) => part.trim() === name)) {
      positions.push([x, y]);
      ids.push(id);
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of positions) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { name, ids, ring: convexHull(positions), box: [minX, minY, maxX, maxY] };
}
