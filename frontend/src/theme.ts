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
}

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
