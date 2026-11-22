/** Day-index arithmetic. A "day" is a whole number of days since the manifest epoch. */

const MS_PER_DAY = 86_400_000;

export function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function makeCalendar(epochIso: string) {
  const epochMs = isoToUtcMs(epochIso);
  const toDate = (day: number) => new Date(epochMs + day * MS_PER_DAY);
  return {
    dayOf(iso: string): number {
      return Math.round((isoToUtcMs(iso) - epochMs) / MS_PER_DAY);
    },
    iso(day: number): string {
      return toDate(day).toISOString().slice(0, 10);
    },
    year(day: number): number {
      return toDate(day).getUTCFullYear();
    },
    date: toDate,
  };
}

export type Calendar = ReturnType<typeof makeCalendar>;

const fmtShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtLong = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const fmtMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const fmtWeekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

export const formatShort = (d: Date) => fmtShort.format(d);
export const formatLong = (d: Date) => fmtLong.format(d);
export const formatMonth = (d: Date) => fmtMonth.format(d);
export const formatWeekday = (d: Date) => fmtWeekday.format(d);

/** "Aug 25 – Nov 22, 2026" or "Dec 28, 2025 – Jan 3, 2026". */
export function formatRange(a: Date, b: Date): string {
  if (a.getTime() === b.getTime()) return formatLong(a);
  if (a.getUTCFullYear() === b.getUTCFullYear()) return `${formatShort(a)} – ${formatLong(b)}`;
  return `${formatLong(a)} – ${formatLong(b)}`;
}

/** 14:05 -> "2:05 PM" */
export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function formatHour(h: number): string {
  return `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
}

export interface Tick {
  day: number;
  label: string;
}

/** Date ticks that suit the span: days for short ranges, months or years for long ones. */
export function dateTicks(d0: number, days: number, cal: Calendar, maxLabels: number): Tick[] {
  const ticks: Tick[] = [];
  const limit = Math.max(2, maxLabels);
  if (days <= 62) {
    const step = [1, 2, 7, 14, 28].find((s) => days / s <= limit) ?? 28;
    for (let d = 0; d < days; d += step) ticks.push({ day: d, label: formatShort(cal.date(d0 + d)) });
    return ticks;
  }
  const months: { day: number; date: Date }[] = [];
  for (let d = 0; d < days; d++) {
    const date = cal.date(d0 + d);
    if (date.getUTCDate() === 1) months.push({ day: d, date });
  }
  const stride = [1, 2, 3, 6, 12, 24].find((s) => months.length / s <= limit) ?? 24;
  for (const m of months) {
    const month = m.date.getUTCMonth();
    if (month % Math.min(stride, 12) !== 0) continue;
    if (stride > 12 && m.date.getUTCFullYear() % (stride / 12) !== 0) continue;
    const year = String(m.date.getUTCFullYear());
    ticks.push({
      day: m.day,
      label: stride >= 12 ? year : month === 0 ? `${formatMonth(m.date)} ’${year.slice(2)}` : formatMonth(m.date),
    });
  }
  return ticks;
}
