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
 * Dark mode draws the same basemap as light mode, recoloured, so both have the
 * same streets, the same labels and the same label sizes. (The provider's own
 * dark style sets street names in 10 px capitals over a busy mesh of outlines,
 * which measured about half as readable as the light map.)
 *
 * The recolouring keeps what makes the light map easy to read: ground,
 * buildings and side streets differ only slightly from each other, main roads
 * stand out a step further, and the lettering is the strongest thing on the map.
 * Label colours follow the interface's dark-mode text.
 */
const GROUND = "#141413";
const HALO = "rgba(20,20,19,0.9)";
const DARK_PLACE = { "text-color": "#f0efec", "text-halo-color": HALO };
const DARK_STREET = { "text-color": "#deddd6", "text-halo-color": HALO, "text-halo-width": 1.5 };
const DARK_ROAD = { "line-color": "#40403e" };
const DARK_CASING = { "line-color": "#0a0a0a" };
const DARK_RAIL = { "line-color": "#343433" };
const DARK_RAIL_DASH = { "line-color": "#1b1b1a" };
const DARK_BOUNDARY = { "line-color": "#5c5c59" };
const DARK_WATER_NAME = { "text-color": "#9db4dd", "text-halo-color": HALO };
const DARK_BASEMAP_PAINT: Record<string, Record<string, unknown>> = {
  background: { "background-color": GROUND },
  park: { "fill-color": "#171b17" },
  water: { "fill-color": "#1b2532" },
  landcover_ice_shelf: { "fill-color": "#222221" },
  landcover_glacier: { "fill-color": "#222221" },
  landuse_residential: { "fill-color": "#171716" },
  landcover_wood: { "fill-color": "#161b16" },
  waterway: { "line-color": "#1b2532" },
  building: { "fill-color": "#1a1a19", "fill-outline-color": "#20201f" },
  tunnel_motorway_casing: { "line-color": "#0e0e0e" },
  tunnel_motorway_inner: { "line-color": "#252524" },
  "aeroway-taxiway": { "line-color": "#262625" },
  "aeroway-runway-casing": { "line-color": "#262625" },
  "aeroway-area": { "fill-color": "#1a1a19" },
  "aeroway-runway": { "line-color": "#343433" },
  road_area_pier: { "fill-color": GROUND },
  road_pier: { "line-color": GROUND },
  highway_path: { "line-color": "#1e1e1d" },
  highway_minor: { "line-color": "#2c2c2b" },
  highway_major_casing: DARK_CASING,
  highway_major_inner: DARK_ROAD,
  highway_major_subtle: { "line-color": "#30302f" },
  highway_motorway_casing: DARK_CASING,
  highway_motorway_inner: { "line-color": "#454543" },
  highway_motorway_subtle: { "line-color": "#30302f" },
  highway_motorway_bridge_casing: DARK_CASING,
  highway_motorway_bridge_inner: { "line-color": "#454543" },
  railway_transit: DARK_RAIL,
  railway_transit_dashline: DARK_RAIL_DASH,
  railway_service: DARK_RAIL,
  railway_service_dashline: DARK_RAIL_DASH,
  railway: DARK_RAIL,
  railway_dashline: DARK_RAIL_DASH,
  boundary_3: DARK_BOUNDARY,
  boundary_2: DARK_BOUNDARY,
  boundary_disputed: DARK_BOUNDARY,
  waterway_line_label: { "text-color": "#8497b5", "text-halo-color": HALO },
  water_name_point_label: DARK_WATER_NAME,
  water_name_line_label: DARK_WATER_NAME,
  "highway-name-path": { "text-color": "#b5b3ac", "text-halo-color": HALO, "text-halo-width": 1 },
  "highway-name-minor": DARK_STREET,
  "highway-name-major": DARK_STREET,
  airport: DARK_STREET,
  label_other: DARK_PLACE,
  label_village: DARK_PLACE,
  label_town: DARK_PLACE,
  label_state: DARK_PLACE,
  label_city: DARK_PLACE,
  label_city_capital: DARK_PLACE,
  label_country_3: DARK_PLACE,
  label_country_2: DARK_PLACE,
  label_country_1: DARK_PLACE,
};

const BASEMAP = "https://tiles.openfreemap.org/styles/positron";

export const THEMES: Record<ThemeName, DataTheme> = {
  light: {
    groups: ["#eb6834", "#2a78d6", "#1baf7a", "#898781"],
    ring: "#ffffff",
    ramp: ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#104281"],
    basemap: BASEMAP,
  },
  dark: {
    groups: ["#d95926", "#3987e5", "#199e70", "#898781"],
    ring: "#0d0d0d",
    // On a dark surface the anchor flips: more is lighter.
    ramp: ["#104281", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#b7d3f6"],
    basemap: BASEMAP,
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
