/**
 * Data colours. Values come from a palette validated for colour-vision
 * deficiency (all pairs, both modes); the three hues are assigned to NIBRS's
 * three classes in a fixed order and never reassigned by rank or filter.
 */
export type ThemeName = "light" | "dark";

export interface DataTheme {
  /** Person, Property, Society, Unclassified */
  groups: [string, string, string, string];
  /** Ring drawn around map points so overlapping ones stay distinct. */
  ring: string;
  /** Sequential ramp, least to most. */
  ramp: string[];
  basemap: string;
  /**
   * Paint values to change in the basemap once it has loaded, by layer id.
   * A layer the basemap no longer has is skipped.
   */
  basemapPaint?: Record<string, Record<string, unknown>>;
}

/**
 * The stock dark basemap draws streets and their names barely lighter than the
 * ground. These lift roads, rail and outlines a few steps, and make the labels
 * as bright as the text in the rest of the interface.
 */
// Label colours match the interface's own dark-mode text: place names use the
// primary text colour (--ink), street names the secondary one (--ink-2).
const DARK_LABEL = { "text-color": "#f0efec", "text-halo-color": "rgba(0,0,0,0.9)" };
const DARK_STREET_LABEL = { "text-color": "#c3c2b7", "text-halo-color": "rgba(0,0,0,0.9)" };
const DARK_BASEMAP_PAINT: Record<string, Record<string, unknown>> = {
  water: { "fill-color": "#1c232e" },
  waterway: { "line-color": "#1c232e" },
  water_name: { "text-color": "#a9bbd3", "text-halo-color": "rgba(0,0,0,0.8)" },
  building: { "fill-outline-color": "#2b2b2d" },
  highway_path: { "line-color": "#38383a" },
  highway_minor: { "line-color": "#343436" },
  highway_major_casing: { "line-color": "#5c5c5f" },
  highway_major_inner: { "line-color": "#3d3d40" },
  highway_major_subtle: { "line-color": "#454548" },
  highway_motorway_casing: { "line-color": "#5c5c60" },
  highway_motorway_inner: { "line-color": "#3c3c40" },
  highway_motorway_subtle: { "line-color": "#454548" },
  railway_transit: { "line-color": "#4a4a4d" },
  railway_minor: { "line-color": "#4a4a4d" },
  railway: { "line-color": "#4a4a4d" },
  boundary_state: { "line-color": "#5a5a5d" },
  highway_name_other: DARK_STREET_LABEL,
  highway_name_motorway: DARK_STREET_LABEL,
  place_other: DARK_LABEL,
  place_suburb: DARK_LABEL,
  place_village: DARK_LABEL,
  place_town: DARK_LABEL,
  place_city: DARK_LABEL,
  place_city_large: DARK_LABEL,
  place_state: DARK_LABEL,
};

export const THEMES: Record<ThemeName, DataTheme> = {
  light: {
    groups: ["#eb6834", "#2a78d6", "#1baf7a", "#898781"],
    ring: "#ffffff",
    ramp: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#104281"],
    basemap: "https://tiles.openfreemap.org/styles/positron",
  },
  dark: {
    groups: ["#d95926", "#3987e5", "#199e70", "#898781"],
    ring: "#0d0d0d",
    // On a dark surface the anchor flips: more is lighter.
    ramp: ["#104281", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#b7d3f6"],
    basemap: "https://tiles.openfreemap.org/styles/dark",
    basemapPaint: DARK_BASEMAP_PAINT,
  },
};

export const GROUP_LABELS = ["Persons", "Property", "Society", "Unclassified"];
export const GROUP_LONG_LABELS = [
  "Crimes against persons",
  "Crimes against property",
  "Crimes against society",
  "No offense classification",
];
/**
 * The order categories are listed in everywhere they appear: property,
 * society, persons, then unclassified. Only the order differs from the data's
 * own numbering; each group keeps its colour.
 */
export const GROUP_ORDER = [1, 2, 0, 3];

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
