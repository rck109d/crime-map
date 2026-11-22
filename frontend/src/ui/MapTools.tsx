import { hexLegend, mapApi } from "../map/MapView";
import { drawing, mode, polygon } from "../state";
import { fmt } from "./format";
import { DrawIcon, HomeIcon } from "./icons";
import { ScaleLegend } from "./ScaleLegend";

function hexSize(radius: number): string {
  // Flat-to-flat width of a hexagon with this circumradius.
  const width = radius * Math.sqrt(3);
  return width >= 950 ? `${(width / 1000).toFixed(1)} km` : `${fmt(Math.round(width / 10) * 10)} m`;
}

export function MapTools() {
  const draft = drawing.value;
  const legend = hexLegend.value;
  return (
    <>
      <div class="map-tools">
        {draft ? (
          <div class="draw-bar" role="group" aria-label="Draw an area">
            <span class="draw-hint">
              {draft.length < 3 ? `Tap the map to outline an area (${draft.length} of at least 3 points)` : `${draft.length} points`}
            </span>
            <button class="pill" disabled={draft.length === 0} onClick={() => (drawing.value = draft.slice(0, -1))}>
              Undo
            </button>
            <button class="pill" onClick={() => (drawing.value = null)}>
              Cancel
            </button>
            <button
              class="pill pill-primary"
              disabled={draft.length < 3}
              onClick={() => {
                polygon.value = draft;
                drawing.value = null;
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div class="segmented segmented-float" role="group" aria-label="Map style">
              <button aria-pressed={mode.value === "points"} onClick={() => (mode.value = "points")}>
                Points
              </button>
              <button aria-pressed={mode.value === "density"} onClick={() => (mode.value = "density")}>
                Density
              </button>
            </div>
            <button class="float-button" onClick={() => (drawing.value = [])} aria-label="Draw an area to filter by" title="Draw an area">
              <DrawIcon />
            </button>
            <button class="float-button" onClick={() => mapApi.resetView()} aria-label="Show the whole city" title="Whole city">
              <HomeIcon />
            </button>
          </>
        )}
      </div>
      {legend && !draft && (
        <div class="map-legend">
          <ScaleLegend breaks={legend.breaks} label={`Incidents per ${hexSize(legend.radius)} hexagon`} />
        </div>
      )}
    </>
  );
}
