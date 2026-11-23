# crime-map

A map of Atlanta Police Department incident reports since 2021, and the
long-term archive behind it.

**Site: <https://rck109d.github.io/crime-map/>**

- Every incident as a point, colored by NIBRS class, or binned into a
  hexagon density map
- Filter by date range, offense, UCR Part I, firearm involvement, family
  violence, neighborhood / NPU / police zone, or an area you draw on the map
- Daily trend lines with adjustable smoothing, a time-of-week grid, and
  rankings by offense and area
- Search for a street, an address, an intersection or a neighborhood; the
  index is built from the archive, so nothing typed leaves the browser
- Tap any spot for the incidents there; download the filtered set as CSV or KML
- Every view has a shareable URL

The data lives in [`data/`](data/) as plain monthly CSV files, refreshed from
APD's open data portal every day. Rows APD later edits or removes are kept in
a separate change log, so its revisions can be studied; see [`data/SCHEMA.md`](data/SCHEMA.md) for
layout, columns and caveats.

## How it fits together

```
APD open data (ArcGIS)
   │  crimemap load            daily, GitHub Actions
   ▼
data/nibrs/YYYY/YYYY-MM.csv    committed: the source of truth
   │  crimemap build-site      on every deploy
   ▼
manifest.json, points-YYYY.bin, detail/YYYY-MM.json, search.json    not committed
   │
   ▼
frontend/ (TypeScript, Preact, MapLibre)  →  GitHub Pages
```

GitHub Pages only serves files, so there is no server: the Python backend
turns the archive into compact files (about 0.45 MB per year of incidents),
and the browser filters and counts them itself. Per-incident text such as
addresses is fetched a month at a time, only when an incident is opened.

| Path | What |
|---|---|
| `data/nibrs/` | The archive: APD's data as it currently stands (committed) |
| `data/nibrs-changes/` | Change log: rows APD removed, and earlier versions of rows it edited |
| `backend/` | Python: `crimemap load` (archive) and `crimemap build-site` (site data) |
| `frontend/` | The web app |
| `.github/workflows/update-data.yml` | Daily refresh that commits new data |
| `.github/workflows/pages.yml` | Builds and deploys the site after each refresh or code change |
| `.github/workflows/test.yml` | Lint and tests for both halves |

## Refreshing the data

The workflow runs every day. To run it by hand: **Actions → Update incident
data → Run workflow**, optionally with a date range. From a terminal:

```sh
gh workflow run update-data.yml                          # last 90 days
gh workflow run update-data.yml -f start=2024-01-01 -f end=2024-12-31
gh workflow run update-data.yml -f full=true             # entire layer
```

APD republishes the whole layer about once an hour, and for a minute or so it
is empty or half loaded. The loader therefore only accepts a fetch whose
responses all come from one publication and whose record count is unchanged
after a pause, retrying for several minutes otherwise. It also refuses to
write a refresh that would leave under 90% of the records already archived
for its range; pass `force` to override that.

## Running locally

Requires [uv](https://docs.astral.sh/uv/) and Node 22. The backend uses only
the Python standard library.

```sh
cd backend
uv run crimemap load                                  # last 90 days into ../data
uv run crimemap load --start 2026-11-01 --end 2026-11-01
uv run crimemap load --all                            # full reload (~3 minutes)
uv run crimemap build-site                            # write frontend/public/data
uv run pytest

cd ../frontend
npm install
npm run dev                                           # http://localhost:5173
npm test && npm run build
```

One-time setup for a fork: in the repository's **Settings → Pages**, set
**Source** to **GitHub Actions**.

## History

This repository began in 2015 as a Groovy loader for APD's former map service,
which wrote incidents to a local MongoDB through Tor. That service is gone; the
Groovy code remains in git history. Its predecessor,
[`atl-pd-data`](https://github.com/rck109d/atl-pd-data), was a Java desktop
tool with a map explorer, heat maps, smoothed daily-crime graphs, polygon
selection and KML export; the web app here carries those features forward.
