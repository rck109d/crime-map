import { effect, signal } from "@preact/signals";
import type { Feature, FeatureCollection } from "geojson";
import {
  AttributionControl,
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "preact/hooks";
import { nearby, rowsAtAddress, visibleBounds, type AreaKind } from "../data/filter";
import { mercatorX, mercatorY, metersPerPixel } from "../data/geo";
import { binHex, classOf, hexAt, hexBreaks, hexRing, rowsInHex } from "../data/hexbin";
import { NO_COORD } from "../data/types";
import {
  area,
  drawing,
  geo,
  manifest,
  mapView,
  mode,
  points,
  polygon,
  selection,
  street,
  summary,
  theme,
  type LngLat,
  type Selection,
} from "../state";
import { THEMES } from "../theme";
import { PointsLayer } from "./pointsLayer";

setWorkerUrl(workerUrl);

const ATLANTA: LngLat = [-84.39, 33.765];
/** Hexagon circumradius on screen, in CSS pixels. */
const HEX_PIXELS = 15;
const TAP_PIXELS = 16;
/** Radius of the circle that marks a searched address on the map. */
const MARKER_METERS = 15;
/** A place from an outside search has no APD address, so incidents near it are shown instead. */
export const PLACE_METERS = 100;

/** Legend data for the density layer. */
export const hexLegend = signal<{ breaks: number[]; radius: number } | null>(null);
/** Space the page chrome covers, so fitted views land in the visible part of the map. */
export const mapInsets = signal({ top: 0, bottom: 0, left: 0, right: 0 });

let map: MapLibreMap | null = null;
const layer = new PointsLayer();
let hexRadius = 0;

type FC = FeatureCollection;
const empty: FC = { type: "FeatureCollection", features: [] };
const setData = (id: string, data: FC) => (map?.getSource(id) as GeoJSONSource | undefined)?.setData(data);

function ink() {
  return theme.value === "dark" ? "#f0efec" : "#0b0b0b";
}

/** Add our sources and layers to a freshly loaded basemap style. */
function install(m: MapLibreMap) {
  const t = THEMES[theme.value];
  // Draw above every road and building but under the labels that end the style,
  // so points are never clipped by basemap shapes and place names stay readable.
  const layers = m.getStyle().layers;
  let labelStart = layers.length;
  while (labelStart > 0 && layers[labelStart - 1].type === "symbol") labelStart--;
  const before = layers[labelStart]?.id;
  for (const id of ["hex", "region", "area", "draft", "pick"]) m.addSource(id, { type: "geojson", data: empty });

  m.addLayer(
    {
      id: "hex-fill",
      type: "fill",
      source: "hex",
      paint: {
        "fill-color": ["match", ["get", "k"], ...t.ramp.flatMap((c, i) => [i, c]), t.ramp[0]] as never,
        "fill-opacity": 0.8,
      },
    },
    before,
  );
  layer.setTheme(t);
  m.addLayer(layer, before);
  // The neighborhood, NPU or zone being filtered to. Dashed, because the
  // outline is only drawn around its incidents and is not an official boundary.
  m.addLayer(
    {
      id: "region-fill",
      type: "fill",
      source: "region",
      paint: { "fill-color": ink(), "fill-opacity": 0.05 },
    },
    before,
  );
  m.addLayer(
    {
      id: "region-line",
      type: "line",
      source: "region",
      paint: { "line-color": ink(), "line-width": 1.5, "line-opacity": 0.7, "line-dasharray": [3, 2] },
    },
    before,
  );
  m.addLayer({
    id: "area-fill",
    type: "fill",
    source: "area",
    paint: { "fill-color": ink(), "fill-opacity": 0.06 },
  });
  m.addLayer({
    id: "area-line",
    type: "line",
    source: "area",
    paint: { "line-color": ink(), "line-width": 2 },
  });
  m.addLayer({
    id: "draft-line",
    type: "line",
    source: "draft",
    filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": ink(), "line-width": 2, "line-dasharray": [2, 1.5] },
  });
  m.addLayer({
    id: "draft-points",
    type: "circle",
    source: "draft",
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5,
      "circle-color": t.ring,
      "circle-stroke-color": ink(),
      "circle-stroke-width": 2,
    },
  });
  m.addLayer({
    id: "pick-fill",
    type: "fill",
    source: "pick",
    paint: { "fill-color": ink(), "fill-opacity": 0.08 },
  });
  m.addLayer({
    id: "pick-line",
    type: "line",
    source: "pick",
    paint: { "line-color": ink(), "line-width": 2.5 },
  });
  pushAll();
}

function pushAll() {
  pushMode();
  pushRegion();
  pushArea();
  pushDraft();
  pushSelection();
}

function pushMode() {
  if (!map?.getLayer("hex-fill")) return;
  const density = mode.value === "density";
  layer.setVisible(!density);
  map.setLayoutProperty("hex-fill", "visibility", density ? "visible" : "none");
  if (density) rebuildHex();
  else hexLegend.value = null;
}

function rebuildHex() {
  const p = points.value;
  const s = summary.value;
  const g = geo.value;
  if (!map?.getSource("hex") || !p || !s || !g || mode.value !== "density") return;
  hexRadius = HEX_PIXELS * metersPerPixel(Math.round(map.getZoom()), g.midLat);
  const cells = binHex(p, s, g, hexRadius);
  const max = cells.reduce((n, c) => Math.max(n, c.count), 0);
  const breaks = hexBreaks(max, THEMES[theme.value].ramp.length);
  setData("hex", {
    type: "FeatureCollection",
    features: cells.map((c) => ({
      type: "Feature",
      properties: { k: classOf(c.count, breaks), n: c.count },
      geometry: { type: "Polygon", coordinates: [hexRing(c.q, c.r, hexRadius, g)] },
    })),
  });
  hexLegend.value = max > 0 ? { breaks, radius: hexRadius } : null;
}

/** Outline of an area as lng/lat corners, or null if it has none. */
function areaRing(kind: AreaKind, id: number): LngLat[] | null {
  const g = geo.value;
  const flat = manifest.value?.outlines?.[kind]?.[id];
  if (!g || !flat || flat.length < 2) return null;
  const ring: LngLat[] = [];
  for (let i = 0; i < flat.length; i += 2) ring.push([g.lng(flat[i]), g.lat(flat[i + 1])]);
  return ring;
}

function pushRegion() {
  const g = geo.value;
  const a = area.value;
  const st = street.value;
  const rings: LngLat[][] = [];
  const areaOutline = a ? areaRing(a.kind, a.id) : null;
  if (areaOutline) rings.push(areaOutline);
  // A street's outline is worked out on the device, from its addresses' positions.
  if (st && g) rings.push(st.ring.map(([x, y]) => [g.lng(x), g.lat(y)] as LngLat));
  setData("region", {
    type: "FeatureCollection",
    // One spot, or points all on one line, have no shape to draw.
    features: rings
      .filter((ring) => ring.length >= 3)
      .map((ring) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
      })),
  });
}

function pushArea() {
  const ring = polygon.value;
  setData(
    "area",
    ring
      ? {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } },
          ],
        }
      : empty,
  );
}

function pushDraft() {
  const pts = drawing.value;
  if (!pts || pts.length === 0) return setData("draft", empty);
  const features: Feature[] = pts.map((c) => ({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: c },
  }));
  if (pts.length >= 2) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: pts.length >= 3 ? [...pts, pts[0]] : pts },
    });
  }
  setData("draft", { type: "FeatureCollection", features });
}

function pushSelection() {
  const sel = selection.value;
  setData(
    "pick",
    sel
      ? {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [sel.ring] } }],
        }
      : empty,
  );
}

function pushPositions() {
  const p = points.value;
  const g = geo.value;
  if (!p || !g) return;
  const ox = mercatorX(ATLANTA[0]);
  const oy = mercatorY(ATLANTA[1]);
  const out = new Float32Array(p.count * 2);
  // Latitude -> mercator is not linear, so convert each distinct step once.
  const yLookup = new Float32Array(65_536);
  for (let q = 0; q < 65_535; q++) yLookup[q] = mercatorY(g.lat(q)) - oy;
  const x0 = mercatorX(g.lng(0)) - ox;
  const xStep = mercatorX(g.lng(1)) - mercatorX(g.lng(0));
  for (let i = 0; i < p.count; i++) {
    if (p.x[i] === NO_COORD) {
      out[i * 2] = out[i * 2 + 1] = 10; // far outside the world square: never drawn
    } else {
      out[i * 2] = x0 + p.x[i] * xStep;
      out[i * 2 + 1] = yLookup[p.y[i]];
    }
  }
  layer.setPositions(out, [ox, oy]);
}

function pushStyle() {
  const s = summary.value;
  const p = points.value;
  if (!s || !p || s.style.length !== p.count) return;
  layer.setStyle(s.style, s.i0, s.i1);
  rebuildHex();
}

function onClick(e: MapMouseEvent) {
  const lngLat: LngLat = [e.lngLat.lng, e.lngLat.lat];
  if (drawing.value) {
    drawing.value = [...drawing.value, lngLat];
    return;
  }
  const p = points.value;
  const s = summary.value;
  const g = geo.value;
  if (!p || !s || !g || !map) return;
  const cx = g.x(lngLat[0]);
  const cy = g.y(lngLat[1]);
  if (mode.value === "density") {
    const [q, r] = hexAt(cx * g.mPerX, cy * g.mPerY, hexRadius);
    const rows = rowsInHex(p, s, g, hexRadius, q, r);
    selection.value = rows.length
      ? { rows, kind: "cell", ring: hexRing(q, r, hexRadius, g, 1), at: lngLat }
      : null;
    return;
  }
  // Everything within a fingertip of the tap; the outline shows exactly what was included.
  const picked = spotAt(lngLat, TAP_PIXELS * metersPerPixel(map.getZoom(), e.lngLat.lat));
  selection.value = picked && picked.rows.length ? picked : null;
}

/** The visible incidents within `reach` metres of a position, with the circle that bounds them. */
function spotAt(lngLat: LngLat, reach: number): Selection | null {
  const p = points.value;
  const s = summary.value;
  const g = geo.value;
  if (!p || !s || !g) return null;
  const cx = g.x(lngLat[0]);
  const cy = g.y(lngLat[1]);
  const rx = reach / g.mPerX;
  const ry = reach / g.mPerY;
  const ring: LngLat[] = [];
  for (let k = 0; k <= 48; k++) {
    const a = (k / 48) * 2 * Math.PI;
    ring.push([g.lng(cx + rx * Math.cos(a)), g.lat(cy + ry * Math.sin(a))]);
  }
  return { rows: nearby(p, s, cx, cy, rx, ry), kind: "spot", ring, at: lngLat };
}

/**
 * Frame a box in the part of the map the page chrome leaves visible.
 *
 * The margins are passed to this one move only. They must never be given to
 * easeTo or jumpTo: there MapLibre keeps them as the map's standing padding,
 * every later fit adds its own on top, and once the total exceeds the canvas
 * the map refuses to move at all (with only a console warning).
 */
function frame(bounds: LngLatBoundsLike, maxZoom: number) {
  if (!map) return;
  const i = mapInsets.value;
  // Extra room at the top for the row of map buttons.
  const margins = { top: i.top + 64, bottom: i.bottom + 24, left: i.left + 24, right: i.right + 24 };
  // If the chrome leaves too little room (a very short screen), frame it in the whole map instead.
  const padding = map.cameraForBounds(bounds, { padding: margins }) ? margins : 24;
  map.fitBounds(bounds, { padding, maxZoom, duration: 600 });
}

/**
 * Where a spot should sit, relative to the middle of the map, to be centred
 * in the part the page chrome leaves visible. `bottom` overrides the measured
 * bottom inset, for when the panel is about to change height.
 */
function visibleCentre(bottom = mapInsets.value.bottom): [number, number] {
  const i = mapInsets.value;
  return [(i.left - i.right) / 2, (i.top - bottom) / 2];
}

/** Controls the rest of the UI uses to move the map. */
export const mapApi = {
  /** Frame the incidents that currently pass the filters. */
  fitVisible() {
    const p = points.value;
    const s = summary.value;
    const g = geo.value;
    if (!map || !p || !s || !g) return;
    const b = visibleBounds(p, s);
    if (!b) return;
    frame(
      [
        [g.lng(b.minX), g.lat(b.minY)],
        [g.lng(b.maxX), g.lat(b.maxY)],
      ],
      15.5,
    );
  },
  /**
   * Frame a neighborhood, NPU or zone by everything ever recorded in it, so
   * the view is the same whatever the date range and filters currently show.
   */
  fitArea(kind: AreaKind, id: number) {
    const ring = areaRing(kind, id);
    if (!ring) return mapApi.fitVisible();
    const lngs = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    frame(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      16,
    );
  },
  resetView() {
    map?.easeTo({ center: ATLANTA, zoom: 10.4, bearing: 0, pitch: 0, duration: 600 });
  },
  /** Frame a box given by its corners, e.g. the extent of a street. */
  fitBox(west: number, south: number, east: number, north: number) {
    frame(
      [
        [west, south],
        [east, north],
      ],
      16.5,
    );
  },
  /**
   * Go to an address found by search and open what is recorded there. The
   * address is selected even when nothing matches the current filters, so the
   * panel can say so instead of leaving the map looking empty.
   */
  showAddress(at: LngLat, address: number, label: string, known: number) {
    const p = points.value;
    const s = summary.value;
    if (!map || !p || !s) return;
    // The circle only marks the spot; the incidents are matched by address,
    // because older reports of the same address can be mapped elsewhere.
    const marker = spotAt(at, MARKER_METERS);
    if (!marker) return;
    selection.value = { ...marker, kind: "address", rows: rowsAtAddress(p, s, address), address, label, known };
    flyTo(at);
  },
  /** Go to a place found by an outside search and list the incidents around it. */
  showPlace(at: LngLat, label: string) {
    const nearbyRows = spotAt(at, PLACE_METERS);
    if (!map || !nearbyRows) return;
    selection.value = { ...nearbyRows, kind: "place", label };
    flyTo(at);
  },
  /** Keep a picked spot clear of the bottom sheet. */
  reveal(at: LngLat) {
    if (!map) return;
    const { x, y } = map.project(at);
    const i = mapInsets.value;
    const box = map.getContainer().getBoundingClientRect();
    if (y > box.height - i.bottom - 40 || y < i.top + 20 || x < i.left + 20 || x > box.width - i.right - 20) {
      map.easeTo({ center: at, offset: visibleCentre(), duration: 400 });
    }
  },
};

/** Move to a searched spot, close enough to see what is there. */
function flyTo(at: LngLat) {
  if (!map) return;
  const i = mapInsets.value;
  // On a phone the panel is about to rise to half height; aim above that.
  const bottom = i.bottom > 0 ? Math.max(i.bottom, innerHeight * 0.56) : 0;
  map.easeTo({
    center: at,
    zoom: Math.max(map.getZoom(), 16.5),
    offset: visibleCentre(bottom),
    duration: 600,
  });
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const start = mapView.peek();
    const m = new MapLibreMap({
      container: container.current!,
      style: THEMES[theme.peek()].basemap,
      center: start ? [start.lng, start.lat] : ATLANTA,
      zoom: start ? start.zoom : 10.4,
      minZoom: 8,
      maxZoom: 19,
      maxBounds: [
        [-85.6, 32.9],
        [-83.2, 34.6],
      ],
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map = m;
    m.touchZoomRotate.disableRotation();
    m.addControl(new AttributionControl({ compact: true }), "bottom-right");
    m.addControl(
      new GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
      "top-right",
    );
    if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
      m.addControl(new NavigationControl({ showCompass: false }), "top-right");
    }

    let shownTheme = theme.peek();
    m.on("style.load", () => install(m));
    m.on("click", onClick);
    m.on("moveend", () => {
      const c = m.getCenter();
      mapView.value = { lng: c.lng, lat: c.lat, zoom: m.getZoom() };
    });
    m.on("zoomend", () => {
      const g = geo.peek();
      if (mode.peek() === "density" && g) {
        const next = HEX_PIXELS * metersPerPixel(Math.round(m.getZoom()), g.midLat);
        if (next !== hexRadius) {
          selection.value = null;
          rebuildHex();
        }
      }
    });

    const stop = [
      effect(() => {
        points.value;
        geo.value;
        pushPositions();
      }),
      effect(() => {
        summary.value;
        pushStyle();
      }),
      effect(() => {
        mode.value;
        pushMode();
      }),
      effect(() => {
        polygon.value;
        pushArea();
      }),
      effect(() => {
        area.value;
        street.value;
        manifest.value;
        pushRegion();
      }),
      effect(() => {
        drawing.value;
        pushDraft();
        m.getCanvas().style.cursor = drawing.value ? "crosshair" : "";
      }),
      effect(() => {
        selection.value;
        pushSelection();
      }),
      effect(() => {
        const next = theme.value;
        if (next !== shownTheme) {
          shownTheme = next;
          m.setStyle(THEMES[next].basemap); // "style.load" re-installs our layers
        }
      }),
    ];
    return () => {
      stop.forEach((dispose) => dispose());
      m.remove();
      map = null;
    };
  }, []);

  return <div ref={container} class="map" role="application" aria-label="Map of incidents" />;
}
