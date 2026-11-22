# crime-map

Long-term archive of Atlanta Police Department crime incidents, refreshed
automatically from APD's open data portal, with a web map to come.

The data lives in [`data/`](data/) as plain monthly CSV files; see
[`data/SCHEMA.md`](data/SCHEMA.md) for layout, columns and caveats.

## Layout

| Path | What |
|---|---|
| `data/` | The archive (committed; the source of truth) |
| `backend/` | Python loader (`crimemap` CLI) |
| `.github/workflows/update-data.yml` | Daily refresh that commits new data |
| `.github/workflows/test.yml` | Backend lint and tests |

A TypeScript map frontend and an API over the archive are planned.

## Refreshing the data

The workflow runs every day. To run it by hand: **Actions → Update incident
data → Run workflow**, optionally with a date range. From a terminal:

```sh
gh workflow run update-data.yml                          # last 90 days
gh workflow run update-data.yml -f start=2024-01-01 -f end=2024-12-31
gh workflow run update-data.yml -f full=true             # entire layer
```

The loader refuses to write a refresh that would shrink the archived records
in its range sharply (below 50% for a date range, 90% for a full reload),
since that usually means the source is broken; pass `force` to override.

## Running locally

Requires [uv](https://docs.astral.sh/uv/). The loader uses only the Python
standard library.

```sh
cd backend
uv run crimemap load                                  # last 90 days into ../data
uv run crimemap load --start 2026-11-01 --end 2026-11-01
uv run crimemap load --all                            # full reload (~3 minutes)
uv run pytest
```

## History

This repository began in 2015 as a Groovy loader for APD's former map service,
which wrote incidents to a local MongoDB through Tor. That service is gone; the
Groovy code remains in git history. Its predecessor, with a desktop map viewer
and heat maps, is [`atl-pd-data`](https://github.com/rck109d/atl-pd-data).
