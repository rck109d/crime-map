import { formatRange } from "./data/dates";
import { toCsv, toKml, type ExportRow } from "./data/export";
import { HIDDEN } from "./data/filter";
import { locate } from "./data/format";
import { loadDetail } from "./data/load";
import { FLAG_FAMILY, FLAG_FIREARM, FLAG_PART1, NO_COORD, type MonthDetail } from "./data/types";
import { applied, calendar, geo, manifest, points, summary } from "./state";

/** Above this, the full archive on GitHub is the better download. */
export const EXPORT_LIMIT = 50_000;

const pad = (n: number) => String(n).padStart(2, "0");

async function collect(onProgress: (done: number, total: number) => void): Promise<ExportRow[]> {
  const m = manifest.value!;
  const p = points.value!;
  const s = summary.value!;
  const cal = calendar.value!;
  const g = geo.value!;

  const rows: number[] = [];
  for (let i = s.i0; i < s.i1; i++) if (s.style[i] !== HIDDEN) rows.push(i);
  const where = rows.map((i) => locate(p, i)!);
  const months = [...new Set(where.map((w) => w.month))];
  const details = new Map<string, MonthDetail>();
  let done = 0;
  // A few at a time: enough to be quick without flooding a phone's connection.
  const queue = [...months];
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let month = queue.shift(); month; month = queue.shift()) {
        details.set(month, await loadDetail(m, month));
        onProgress(++done, months.length);
      }
    }),
  );

  return rows.map((i, k) => {
    const w = where[k];
    const d = details.get(w.month)!;
    const offense = m.offenses[p.offense[i]];
    const mapped = p.x[i] !== NO_COORD;
    return {
      incident: d.inc[w.row],
      reported: `${cal.iso(p.day[i])} ${pad(Math.floor(p.minute[i] / 60))}:${pad(p.minute[i] % 60)}`,
      occurredFrom: d.from[w.row].replace("T", " "),
      occurredTo: d.to[w.row].replace("T", " "),
      offense: offense.name,
      category: m.groups[offense.group],
      firearm: (p.flags[i] & FLAG_FIREARM) !== 0,
      familyViolence: (p.flags[i] & FLAG_FAMILY) !== 0,
      partI: (p.flags[i] & FLAG_PART1) !== 0,
      victims: d.vic[w.row] ?? "",
      address: d.addr[w.row],
      locationType: m.locationTypes[d.loc[w.row]] ?? "",
      neighborhood: m.nhoods[p.nhood[i]],
      npu: m.npus[p.npu[i]],
      zone: m.zones[p.zone[i]],
      beat: d.beat[w.row],
      longitude: mapped ? Number(g.lng(p.x[i]).toFixed(6)) : null,
      latitude: mapped ? Number(g.lat(p.y[i]).toFixed(6)) : null,
    };
  });
}

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function exportFiltered(format: "csv" | "kml", onProgress: (done: number, total: number) => void) {
  const cal = calendar.value!;
  const r = applied.value;
  const rows = await collect(onProgress);
  const stem = `atlanta-incidents_${cal.iso(r.d0)}_${cal.iso(r.d1)}`;
  if (format === "csv") download(toCsv(rows), `${stem}.csv`, "text/csv");
  else {
    const title = `Atlanta incidents, ${formatRange(cal.date(r.d0), cal.date(r.d1))}`;
    download(toKml(rows, title), `${stem}.kml`, "application/vnd.google-earth.kml+xml");
  }
}
