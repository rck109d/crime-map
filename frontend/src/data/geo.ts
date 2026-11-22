import type { Manifest } from "./types";

const DEG = Math.PI / 180;

/** Conversions between the files' quantized coordinates, lng/lat, and metres. */
export function makeGeo(manifest: Pick<Manifest, "bbox" | "coordSteps">) {
  const { west, south, east, north } = manifest.bbox;
  const steps = manifest.coordSteps;
  const lngPerStep = (east - west) / steps;
  const latPerStep = (north - south) / steps;
  const midLat = (south + north) / 2;
  return {
    lng: (x: number) => west + x * lngPerStep,
    lat: (y: number) => south + y * latPerStep,
    x: (lng: number) => (lng - west) / lngPerStep,
    y: (lat: number) => (lat - south) / latPerStep,
    /** Metres per quantization step: a local flat projection, good to ~0.3% across the city. */
    mPerX: lngPerStep * 111_320 * Math.cos(midLat * DEG),
    mPerY: latPerStep * 110_540,
    midLat,
  };
}

export type Geo = ReturnType<typeof makeGeo>;

/** Web-mercator position in the 0..1 world square MapLibre uses. */
export const mercatorX = (lng: number) => (lng + 180) / 360;
export const mercatorY = (lat: number) =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2)) / Math.PI) / 2;

/** Ground metres per CSS pixel at a zoom level (512px tiles, as in MapLibre). */
export const metersPerPixel = (zoom: number, lat: number) =>
  (78_271.517 * Math.cos(lat * DEG)) / 2 ** zoom;

export type Ring = ReadonlyArray<readonly [number, number]>;

/** Even-odd point-in-polygon test; the ring need not be closed. */
export function pointInRing(px: number, py: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
