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
only through a manual run. Every change is a git commit, so a record APD later
removes is still recoverable from history.

## Querying

The CSVs are the source of truth; build any database from them. With DuckDB:

```sql
SELECT NIBRS_Offense, count(*) AS n
FROM read_csv('data/nibrs/2*/*.csv', union_by_name = true, all_varchar = true)
WHERE ReportDate >= '2026-01-01'
GROUP BY 1 ORDER BY n DESC;
```

`union_by_name` keeps old files readable if APD adds columns later.
