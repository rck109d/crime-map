/**
 * The two outside place-search services, both built on OpenStreetMap data.
 * Unlike the local search, a query here is sent to the service named.
 *
 *   Photon      photon.komoot.io; made for search-as-you-type
 *   Nominatim   nominatim.openstreetmap.org; its usage policy does not allow
 *               search-as-you-type, so it is only asked on an explicit Search
 */

export interface PlaceHit {
  label: string;
  /** What kind of place it is and roughly where. */
  note: string;
  lng: number;
  lat: number;
}

export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

const inside = (box: Box, lng: number, lat: number) =>
  lng >= box.west && lng <= box.east && lat >= box.south && lat <= box.north;

/** "swimming_pool" -> "Swimming pool" */
function readable(tag: unknown): string {
  if (typeof tag !== "string" || !tag || tag === "yes") return "";
  const text = tag.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const join = (parts: unknown[]) => parts.filter((p) => typeof p === "string" && p).join(" · ");

export function photonUrl(query: string, box: Box, limit = 8): string {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    lang: "en",
    // Only places inside the area the map covers.
    bbox: `${box.west},${box.south},${box.east},${box.north}`,
  });
  return `https://photon.komoot.io/api/?${params}`;
}

/** Read a Photon (GeoJSON) response, ignoring anything malformed or outside the map. */
export function parsePhoton(body: unknown, box: Box): PlaceHit[] {
  const features = (body as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const hits: PlaceHit[] = [];
  for (const feature of features as { geometry?: { coordinates?: unknown[] }; properties?: Record<string, unknown> }[]) {
    const [lng, lat] = feature.geometry?.coordinates ?? [];
    const p = feature.properties ?? {};
    if (typeof lng !== "number" || typeof lat !== "number" || !inside(box, lng, lat)) continue;
    const street = join([[p.housenumber, p.street].filter(Boolean).join(" ")]);
    const label = typeof p.name === "string" && p.name ? p.name : street;
    if (!label) continue;
    hits.push({ label, note: join([readable(p.osm_value), label === street ? "" : street, p.city]), lng, lat });
  }
  return hits;
}

export function nominatimUrl(query: string, box: Box, limit = 8): string {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(limit),
    viewbox: `${box.west},${box.north},${box.east},${box.south}`,
    bounded: "1",
  });
  return `https://nominatim.openstreetmap.org/search?${params}`;
}

/** Read a Nominatim (jsonv2) response, ignoring anything malformed or outside the map. */
export function parseNominatim(body: unknown, box: Box): PlaceHit[] {
  if (!Array.isArray(body)) return [];
  const hits: PlaceHit[] = [];
  for (const row of body as Record<string, unknown>[]) {
    const lng = Number(row.lon);
    const lat = Number(row.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !inside(box, lng, lat)) continue;
    // display_name is "Name, street, neighbourhood, city, county, state, zip, country".
    const parts = typeof row.display_name === "string" ? row.display_name.split(", ") : [];
    const label = typeof row.name === "string" && row.name ? row.name : parts[0];
    if (!label) continue;
    const rest = parts[0] === label ? parts.slice(1, 3) : parts.slice(0, 2);
    hits.push({ label, note: join([readable(row.type), rest.join(", ")]), lng, lat });
  }
  return hits;
}
