/** Shapes of the files written by `crimemap build-site` (backend/src/crimemap/site.py). */

export interface OffenseInfo {
  name: string;
  code: string;
  bucket: string;
  /** UCR Part I: the FBI's traditional index crimes. */
  part1: boolean;
  /** Index into Manifest.groups. */
  group: number;
}

export interface MonthInfo {
  /** "YYYY-MM" */
  month: string;
  count: number;
}

export interface YearInfo {
  year: number;
  count: number;
  months: MonthInfo[];
}

/** A span of report dates one dataset covers (ISO dates, inclusive). */
export interface Coverage {
  /** "historical": APD's pre-NIBRS records, 1997-2020. "nibrs": 2021 on. */
  source: string;
  from: string;
  to: string;
}

export interface Manifest {
  version: number;
  build: string;
  /** ISO date that day index 0 refers to. */
  epoch: string;
  /** Latest report date in the data, ISO. */
  through: string;
  count: number;
  unmapped: number;
  bbox: { west: number; south: number; east: number; north: number };
  coordSteps: number;
  groups: string[];
  offenses: OffenseInfo[];
  nhoods: string[];
  npus: string[];
  zones: string[];
  /**
   * Per area id, an outline drawn around every incident position recorded in
   * that area, as flat quantized [x0, y0, x1, y1, ...]; null where nothing is
   * mapped. A sketch of where the area is, not its official boundary.
   */
  outlines?: { nhood: (number[] | null)[]; npu: (number[] | null)[]; zone: (number[] | null)[] };
  locationTypes: string[];
  years: YearInfo[];
  /** Report-date spans with data, ascending; days between them have none at all. */
  coverage?: Coverage[];
}

/** Column-oriented incident table; row i is one offense record. */
export interface PointColumns {
  count: number;
  /** Report date, days since Manifest.epoch (Atlanta local date). */
  day: Uint16Array;
  /** Report time, minutes after local midnight, or UNKNOWN_MINUTE (historical records). */
  minute: Uint16Array;
  /** Quantized longitude / latitude; NO_COORD when unmapped. */
  x: Uint16Array;
  y: Uint16Array;
  nhood: Uint16Array;
  offense: Uint8Array;
  npu: Uint8Array;
  zone: Uint8Array;
  flags: Uint8Array;
  /** Local hour the offense began, or UNKNOWN. */
  occHour: Uint8Array;
  /** Day of week the offense began (0 = Sunday), or UNKNOWN. */
  occDow: Uint8Array;
  /** Low 16 and high 8 bits of the address id. */
  addrLo: Uint16Array;
  addrHi: Uint8Array;
}

/** Where a run of rows came from, for looking up its detail file. */
export interface Segment {
  month: string;
  start: number;
  count: number;
}

export interface Points extends PointColumns {
  /** Colour group per row, derived from the offense. */
  group: Uint8Array;
  /**
   * Id of the row's street address; 0 when APD recorded none. Rows at one
   * address share an id even when APD has mapped it to different positions.
   */
  address: Uint32Array;
  segments: Segment[];
  /** Years present, ascending. */
  years: number[];
}

export interface MonthDetail {
  inc: string[];
  /** Report sequence: "1" for the original report, higher for supplements. */
  rep: string[];
  addr: string[];
  from: string[];
  to: string[];
  loc: number[];
  beat: string[];
  /** Victim count; APD records it for crimes against persons only, so usually "". */
  vic: string[];
  /** Historical months only: how APD recorded the offense, e.g. "ROB-STREET-GUN" or "ROBBERY (1204)". */
  type?: string[];
}

export const NO_COORD = 0xffff;
export const UNKNOWN = 255;
export const UNKNOWN_MINUTE = 0xffff;
export const FLAG_FIREARM = 1;
export const FLAG_FAMILY = 2;
export const FLAG_PART1 = 4;
/** This row is another offense of the same report as the row before it. */
export const FLAG_SAME_INCIDENT = 8;
export const GROUP_COUNT = 4;
