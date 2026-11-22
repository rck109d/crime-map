/** Plain-text exports of the filtered incidents (CSV for spreadsheets, KML for map tools). */

export interface ExportRow {
  incident: string;
  reported: string;
  occurredFrom: string;
  occurredTo: string;
  offense: string;
  category: string;
  firearm: boolean;
  address: string;
  locationType: string;
  neighborhood: string;
  npu: string;
  zone: string;
  beat: string;
  longitude: number | null;
  latitude: number | null;
}

const COLUMNS: (keyof ExportRow)[] = [
  "incident",
  "reported",
  "occurredFrom",
  "occurredTo",
  "offense",
  "category",
  "firearm",
  "address",
  "locationType",
  "neighborhood",
  "npu",
  "zone",
  "beat",
  "longitude",
  "latitude",
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  // Stop spreadsheets from running a cell that starts like a formula.
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) lines.push(COLUMNS.map((c) => csvCell(row[c])).join(","));
  return lines.join("\n") + "\n";
}

const xml = (text: string) =>
  text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** KML document with one placemark per mapped incident, grouped in a folder per category. */
export function toKml(rows: ExportRow[], name: string): string {
  const folders = new Map<string, string[]>();
  for (const row of rows) {
    if (row.longitude === null || row.latitude === null) continue;
    const lines = [
      `<b>${xml(row.offense)}</b>`,
      `Reported ${xml(row.reported)}`,
      row.address && xml(row.address),
      row.neighborhood && xml(row.neighborhood),
      `Incident ${xml(row.incident)}`,
    ].filter(Boolean);
    const placemark =
      `<Placemark><name>${xml(row.offense)}</name>` +
      `<description><![CDATA[${lines.join("<br/>").replace(/]]>/g, "]]&gt;")}]]></description>` +
      `<TimeStamp><when>${xml(row.reported.slice(0, 10))}</when></TimeStamp>` +
      `<Point><coordinates>${row.longitude},${row.latitude},0</coordinates></Point></Placemark>`;
    let list = folders.get(row.category);
    if (!list) folders.set(row.category, (list = []));
    list.push(placemark);
  }
  const body = [...folders]
    .map(([category, marks]) => `<Folder><name>${xml(category)}</name>\n${marks.join("\n")}\n</Folder>`)
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n` +
    `<Document><name>${xml(name)}</name>\n${body}\n</Document>\n</kml>\n`
  );
}
