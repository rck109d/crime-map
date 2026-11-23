import { useState } from "preact/hooks";
import { formatLong } from "../data/dates";
import { EXPORT_LIMIT, exportFiltered } from "../exporting";
import { calendar, lastDay, manifest, setThemePref, summary, themePref, type ThemePref } from "../state";
import { Dialog } from "./Dialog";
import { fmt, plural } from "./format";
import { DownloadIcon } from "./icons";

const REPO = "https://github.com/rck109d/crime-map";
const THEME_CHOICES: { id: ThemePref; label: string }[] = [
  { id: "auto", label: "Match device" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function About({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = manifest.value;
  const cal = calendar.value;
  const s = summary.value;
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const total = s?.total ?? 0;
  const tooMany = total > EXPORT_LIMIT;

  const run = async (format: "csv" | "kml") => {
    setWorking(true);
    setStatus("Preparing…");
    try {
      await exportFiltered(format, (done, n) => setStatus(`Loading details: ${done} of ${n} months`));
      setStatus(`Saved ${plural(total, "incident")} as ${format.toUpperCase()}.`);
    } catch {
      setStatus("The download could not be prepared. Check your connection and try again.");
    }
    setWorking(false);
  };

  return (
    <Dialog title="About & export" open={open} onClose={onClose}>
      <section class="about">
        <h3>Download what you see</h3>
        <p>
          {total === 0
            ? "No incidents match the current filters."
            : tooMany
              ? `${fmt(total)} incidents match your filters. Narrow them to ${fmt(EXPORT_LIMIT)} or fewer to download from here, or take the complete archive from GitHub.`
              : `${plural(total, "incident")} match your filters.`}
        </p>
        <div class="button-row">
          <button class="button" disabled={working || tooMany || total === 0} onClick={() => run("csv")}>
            <DownloadIcon /> CSV
          </button>
          <button class="button" disabled={working || tooMany || total === 0} onClick={() => run("kml")}>
            <DownloadIcon /> KML
          </button>
          <a class="button button-quiet" href={`${REPO}/tree/master/data`} target="_blank" rel="noopener">
            Full archive
          </a>
        </div>
        <p class="fine" role="status">
          {status ?? "CSV opens in a spreadsheet; KML opens in Google Earth and other map tools."}
        </p>

        <h3>Appearance</h3>
        <div class="segmented" role="group" aria-label="Color theme">
          {THEME_CHOICES.map((c) => (
            <button key={c.id} aria-pressed={themePref.value === c.id} onClick={() => setThemePref(c.id)}>
              {c.label}
            </button>
          ))}
        </div>

        <h3>About the data</h3>
        {m && cal && (
          <p>
            {fmt(m.count)} offense records reported to the Atlanta Police Department from January 2021 through{" "}
            {formatLong(cal.date(lastDay.value))}, as published on the{" "}
            <a href="https://opendata.atlantapd.org/" target="_blank" rel="noopener">
              APD Open Data Portal
            </a>
            . This site keeps a daily copy in a{" "}
            <a href={REPO} target="_blank" rel="noopener">
              public archive
            </a>{" "}
            and is not affiliated with APD.
          </p>
        )}
        <ul class="notes">
          <li>
            APD reclassifies and removes reports after publishing them, so recent counts change. The data cannot be
            used to recreate an official crime report.
          </li>
          <li>
            Each record is one offense. An incident involving several offenses appears once for each, so counts are
            offenses, not events or people. Tapping the map gathers an incident's offenses onto one card.
          </li>
          <li>
            Colors follow the FBI's NIBRS classes: crimes against persons, property, and society. Robbery, for
            example, is a property crime in NIBRS.
          </li>
          <li>
            “Unclassified” records were published without a NIBRS offense. Locations are the addresses APD
            publishes{m && m.unmapped > 0 ? `; ${fmt(m.unmapped)} records have none that can be mapped` : ""}.
          </li>
          <li>
            “Part I only” keeps the offenses APD marks as Part I, the FBI's traditional list of serious crimes:
            homicide, rape, robbery, aggravated assault, burglary, theft, motor vehicle theft, arson and human
            trafficking. “Family violence” is APD's flag under Georgia law. A victim count is
            recorded for crimes against persons only.
          </li>
          <li>Dates filter by when an incident was reported, which can be days or months after it happened.</li>
          <li>
            Search has three tabs. Local runs on your device and sends nothing anywhere. Photon and Nominatim find
            businesses and landmarks by sending what you type to those services (Photon as you type, Nominatim only
            when you press Search); a place result lists the incidents within 100 m of it.
          </li>
        </ul>
        <p class="fine">
          Basemap © <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>,{" "}
          <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> and{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.
        </p>
      </section>
    </Dialog>
  );
}
