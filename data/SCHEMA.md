# Archived data

Plain-text archive of Atlanta Police Department (APD) crime incidents, kept in
git so it survives changes to APD's own systems. Everything here is UTF-8 CSV
with a header row, `\n` line endings and standard double-quote escaping, so it
can be read by any tool without this repository's code.

## `nibrs/`: NIBRS incidents, 2021 onward

Source: APD Open Data Portal (<https://opendata.atlantapd.org/>), ArcGIS
feature service recorded in [`nibrs/source.json`](nibrs/source.json) along
with the source's field list at the time of the last refresh. The live source
starts in 2021; the handful of earlier report dates in it are stray records,
not a complete history.

### Files

| Path | Contents |
|---|---|
| `nibrs/YYYY/YYYY-MM.csv` | Records whose `ReportDate` falls in that month, **Atlanta local time** |
| `nibrs/unusual-dates.csv` | Records with a missing `ReportDate` or one before 1980 or in the future (source data-entry errors, e.g. the year 1015 or 2124) |
| `nibrs/source.json` | Source URL and field definitions |

Rows in each file are sorted by `ReportDate`, then `IncidentNumber`,
`NibrsUcrCode`, then every other column, so re-running a refresh with no
upstream change rewrites nothing.

### Row grain

One row per **offense within an incident**. An incident with three offenses
has three rows sharing an `IncidentNumber`. `(IncidentNumber, NibrsUcrCode)`
is almost but not entirely unique: APD occasionally reuses an incident number
for a later report, and the source contains a few exact duplicate rows. Both
are kept as published.

### Columns

All values are text; an empty field means the source value was null. The
column order follows the source. Descriptions below are inferred from the
data, as APD does not publish a data dictionary for this layer.

| Column | Meaning |
|---|---|
| `ChargeId_First` | Charge identifier (empty in every record so far) |
| `IncidentNumber` | APD incident number |
| `ReportNumber` | Report number, `IncidentNumber-<supplement>` |
| `FireArmInvolved` | `yes` / `no` |
| `ReportDate` | When the incident was reported |
| `OccurredFromDate`, `OccurredToDate` | Window in which the offense occurred |
| `Day_of_the_week`, `Day_Number` | Day of `OccurredFromDate` (Sunday = 1) |
| `Part` | UCR `Part I` / `Part II` |
| `Crime_Against` | NIBRS category: Person, Property, Society |
| `NibrsUcrCode` | NIBRS offense code, e.g. `13A`, `23C` |
| `NIBRS_Offense` | NIBRS offense name |
| `NIBRS_Bucket` | APD's broader grouping of the offense |
| `Vic_Count` | Number of victims |
| `StreetAddress` | Block-level address |
| `LocationType` | NIBRS location type, e.g. `GROCERY_SUPERMARKET` |
| `Longitude`, `Latitude` | WGS 84 coordinates |
| `IsBiasMotivationInvolved` | `true` / `false` |
| `event_watch` | APD watch (shift): `Morning Watch`, `Day Watch`, `Evening Watch` |
| `Zone`, `Zone_int` | APD zone: `Zone 1`..`Zone 6` or `Airport` |
| `BEAT`, `BEAT_Text` | APD beat |
| `DISTRICT` | City council district (1-12) |
| `NPU` | Neighborhood Planning Unit letter |
| `NhoodName` | Neighborhood name |
| `CriminalGangActivityInvolved` | Gang activity indicator (empty in every record so far) |
| `GAFamilyViolenceIndicator` | Georgia family-violence indicator |

**Dates** are ISO 8601 in Atlanta local time with an explicit UTC offset, e.g.
`2026-11-01T13:57:38-05:00`. The source stores UTC; the offset makes each
value unambiguous across daylight-saving changes. (Dates before 1883, which
only appear in `unusual-dates.csv`, carry the historical local mean time offset
`-04:56:02`.) The `OBJECTID` column is dropped because ArcGIS reassigns it each
time APD republishes the layer.

### How it is kept up to date

A GitHub Actions workflow (`.github/workflows/update-data.yml`) runs daily and
re-fetches the **last 90 days** of report dates, replacing that window so
APD's later reclassifications and duplicate removals are mirrored. Rows older
than the window are never modified or deleted by the daily run; they change
only through a manual run. Whatever the refresh replaces or drops is first
copied to the change log described below, and every change is also a git
commit.

## `nibrs-changes/`: removed rows and earlier versions

`nibrs/` always shows APD's data as it currently stands. This is the record of
what it used to say: every time a refresh replaces or drops an archived row,
that row is appended here first, exactly as it was.

| Path | Contents |
|---|---|
| `nibrs-changes/YYYY/YYYY-MM.csv` | Rows that left the archive, filed by the month the change was **noticed** |
| `nibrs-changes/YYYY/YYYY-MM.partN.csv` | Continuation, if one month's log passes 150,000 rows |

Each row is the old archived row (same columns as `nibrs/`) with three
columns in front:

| Column | Meaning |
|---|---|
| `observed_at` | When the refresh noticed the change (Atlanta time). APD made it some time since the previous refresh. |
| `change` | What happened to the row; see below |
| `new_values` | For `changed` only: a JSON object of the fields that differ, with their new values |

| `change` | Meaning |
|---|---|
| `changed` | The same incident and offense is still published, with different values. The row holds the old values; `new_values` holds the new ones. |
| `offense_removed` | The incident is still published, but no longer with this offense. Usually a reclassification: look up the incident number in `nibrs/` to see what it became. |
| `duplicate_removed` | An identical row is still published; APD dropped a duplicate. |
| `removed` | The incident is no longer published at all. |

Things to know when reading it:

- It starts on 2026-11-22. Changes APD made before then were never seen.
- Only rows inside a refresh's range are compared: the last 90 days for the
  daily run, everything for a manual full reload.
- New incidents are not logged; they simply appear in `nibrs/`.
- A record edited several times has one row per edit. Ordered by
  `observed_at`, each row's successor is the next row for the same incident
  and offense, or the current row in `nibrs/`.
- A `removed` row can reappear later: if a record is absent from one refresh
  and back in the next, it is logged as removed and then is simply present
  again. Check `nibrs/` before treating a removal as permanent.
- APD adding or retiring a column is not logged as a change to every record.

```sql
-- Which fields does APD edit most often after publishing?
SELECT key AS field, count(*) AS edits
FROM read_csv('data/nibrs-changes/*/*.csv', union_by_name = true, all_varchar = true),
     json_each(new_values)
WHERE change = 'changed'
GROUP BY 1 ORDER BY edits DESC;

-- How long after the report date are records removed?
SELECT change, date_diff('day', CAST(ReportDate AS TIMESTAMPTZ), CAST(observed_at AS TIMESTAMPTZ)) AS days_later,
       count(*) AS n
FROM read_csv('data/nibrs-changes/*/*.csv', union_by_name = true, all_varchar = true)
WHERE change <> 'changed'
GROUP BY ALL ORDER BY 1, 2;
```

## The web map's files

The site at <https://rck109d.github.io/crime-map/> does not read these CSVs
directly. On each deploy, `crimemap build-site` derives compact files from
them (`manifest.json`, `points-YYYY.bin`, `detail/YYYY-MM.json`, and
`search.json`, the street and address index behind the map's search); those are
build output and are not committed. The map shows `historical/` (1997-2020)
and `nibrs/` report dates from 2021 onward; it leaves out the stray pre-2021
rows in `nibrs/`, the `unusual-dates.csv` files and the change log. Of the
columns above it uses the offense, class, dates, address, location type,
coordinates, area fields, firearm and family-violence indicators, `Part` and
`Vic_Count`, plus `Source`, `SourceCategory` and `SourceOffense` for
historical rows.

## `historical/`: pre-NIBRS incidents, 1997-2020

Source: APD's two historical ArcGIS layers on the same ArcGIS organisation as
`nibrs/`, published once in January 2023 and not updated since:

| `Source` | Layer | Report dates | Records |
|---|---|---|---|
| `1997-2008` | `Crime_Data_1997_2008` | 1997-01-01 to 2008-12-31 | 579,827 |
| `2009-2020` | `2009_2020CrimeData` | 2009-01-01 to 2020-12-31 | 366,824 |

(`https://services3.arcgis.com/Et5Qfajgiyosiw4d/arcgis/rest/services/<layer>/FeatureServer/0`.)
`crimemap load-historical` fetches both and rewrites this directory; nothing
refreshes it automatically.

| Path | Contents |
|---|---|
| `historical/YYYY/YYYY-MM.csv` | Records whose report date falls in that month |
| `historical/unusual-dates.csv` | Records with no report date (if any) |

Rows are sorted by `ReportDate`, `IncidentNumber`, `NibrsUcrCode`. One record
of the 1997-2008 layer has a 2014 report date, kept where it falls.

**Coverage differs from `nibrs/`.** Both layers hold only the FBI's index
(Part I) crimes: homicide, rape (1997-2008 only), robbery, aggravated
assault, burglary, larceny and motor vehicle theft. There are no drug, fraud,
vandalism, simple assault or other Part II offenses, so compare eras with
Part I offenses, not totals. Report dates have no time of day. There is no
location type, victim count or family-violence indicator.

**Duplicates.** Records repeated with every field identical are kept once
(1,081 in the 1997-2008 layer). Records sharing an incident number but
differing in any field are kept.

| Column | Meaning |
|---|---|
| `Source` | Which layer the row came from: `1997-2008` or `2009-2020` |
| `IncidentNumber` | APD incident (report) number |
| `ReportDate` | Report date, `YYYY-MM-DD` (no time recorded) |
| `OccurredFromDate`, `OccurredToDate` | Window the offense occurred in, ISO 8601 Atlanta time; a bare date when only the date was recorded |
| `SourceCategory` | The layer's UCR category, e.g. `ROBBERY-PEDESTRIAN`, `LARCENY-FROM VEHICLE` |
| `SourceOffense` | 1997-2008: APD's crime type, e.g. `ROB-STREET-GUN`. 2009-2020: APD's offense code, e.g. `1204` (see below) |
| `NibrsUcrCode`, `NIBRS_Offense`, `Crime_Against`, `Part`, `NIBRS_Bucket` | The nearest NIBRS offense, with the same names and classes as `nibrs/` |
| `FireArmInvolved` | `yes` when the type or code names a gun, `no` when it names another weapon or none, empty when a homicide, rape, robbery or assault record says nothing about the weapon |
| `StreetAddress` | Block-level address (2009-2020: the part of `Location` before any `@ place name`) |
| `Longitude`, `Latitude` | WGS 84; empty where the layer has 0 |
| `BEAT`, `Zone` | APD beat and zone (`Zone 1`-`Zone 6`) at the time |
| `NPU`, `NhoodName` | As the layer records them; some old names no longer appear in `nibrs/` |
| `src_*` | The source fields the columns above do not carry, as published (`NULL` text emptied). 1997-2008: `UCR__` (APD's 3-digit offense code), `Location` (location type code), `Shift`, `Apt`, `Intersection*`, `Weapon` and `Disp` (codes), `F__Vics` (victims), `Current_beat`, `Current_Zone`, `Councildist`. 2009-2020: `Location` (the address as entered, often with `@ place name`), `Apartment_Number` |

**Dates.** The 1997-2008 layer stores report and occurrence dates as Atlanta
midnight and times as Atlanta wall-clock times on a dummy date (2023-01-07);
the 2009-2020 layer stores the report date at UTC midnight and occurrence
dates and times as text (`9/3/2013`, `13:30`). Both are converted to the
columns above.

**NIBRS mapping.** The record's category decides the offense: homicide `09A`,
manslaughter `09B`, rape `11A`, robbery `120`, aggravated assault `13A`,
burglary `220`, auto theft `240`, larceny from vehicle `23F`, other larceny
`23H`. The 1997-2008 crime type, or the 2009-2020 code, refines it:

- 1997-2008 types: vehicle parts `23G`, shoplifting `23C`, pocket-picking
  `23A`, sudden snatch (purse-snatching) `23B`, coin machine `23E`, theft from
  building `23D`, plus a few dozen stray records (simple assault,
  intimidation, forgery, disorderly conduct and others). 18
  `NON-CRIMINAL REPORT` records have no offense.
- 2009-2020 codes, which are NCIC-style offense codes; their meanings were
  confirmed by joining 2009-2012 records to an APD export of the same years
  that spells out each crime type:

| Code | Meaning | Mapped to |
|---|---|---|
| `1201`-`1203` | Robbery, business: gun / other weapon / strongarm (`C` gas station, `D`/`L`/`Q`/`R`/`Y` convenience store, `K` knife, `X` gas station) | `120` |
| `1204`-`1206` | Robbery, street: gun / other weapon / strongarm (`1205K` knife) | `120` |
| `1207`-`1209` | Robbery, residence: gun / other weapon / strongarm (`1208K` knife) | `120` |
| `1211`, `1299` + `G`/`K`/`O`/`S` | Robbery, bank / other: gun, knife, other weapon, strongarm | `120` |
| `1212` | Forcible purse-snatching | `120` |
| `1314`, `1315`, `1315K` | Aggravated assault: gun, other weapon, knife | `13A` |
| `901`, `903`, `911` / `902`, `904`, `912` | Homicide: gun / other weapon | `09A` |
| `2202`-`2205` | Burglary: forced residence, forced non-residence, unforced residence, unforced non-residence (`A`: attempt) | `220` |
| `2301`, `2302`, `2303`, `2304`, `2305`, `2307`, `2308` | Pocket-picking, purse-snatching, shoplifting, vehicle parts, from vehicle, coin machine, from building | `23A`, `23B`, `23C`, `23G`, `23F`, `23E`, `23D` |
| `2404`, `2424`, `2434` | Theft of auto, truck, other vehicle (`A`: attempt) | `240` |
| NIBRS codes (`13A`, `23F`, ...) | Already NIBRS | as given |

Other codes (`1313`, `1399`, `2399`, stray `2902`, `9999`, `NULL`...) keep the
category's offense; they leave the firearm question open for homicide,
robbery and assault. Attempts keep the offense they attempted, as in NIBRS.
The rules are in `backend/src/crimemap/historical.py`.

## Querying

The CSVs are the source of truth; build any database from them. With DuckDB:

```sql
SELECT NIBRS_Offense, count(*) AS n
FROM read_csv('data/nibrs/2*/*.csv', union_by_name = true, all_varchar = true)
WHERE ReportDate >= '2026-01-01'
GROUP BY 1 ORDER BY n DESC;
```

`union_by_name` keeps old files readable if APD adds columns later.
