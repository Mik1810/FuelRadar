# FuelRadar TODO

## Done

- Defined MVP scope and roadmap in `ROADMAP.md`.
- Documented MIMIT data source details in `DATA_SOURCE.md`.
- Downloaded local MIMIT CSV samples into `data/mimit/`.
- Ignored local CSV samples with `.gitignore`.
- Added Bun and TypeScript setup.
- Added `scripts/analyze-mimit-data.ts` to inspect MIMIT CSV quality.
- Added `scripts/query-mimit-nearby.ts` to simulate nearby price queries.
- Confirmed MIMIT daily CSV files expose `ETag` and `Last-Modified`.
- Confirmed latest daily MIMIT dataset is a better product rule than strict
  same-day `dtComu` filtering.
- Created Expo SDK 54 app compatible with current Expo Go on iPhone.
- Migrated the app shell to the `Fuel-Finder` Expo base.
- Configured app name, icon, Expo Router, native tabs, Liquid Glass fallback,
  and native map components.
- Excluded `Fuel-Finder/`, `.expo/`, `node_modules/`, and local CSV data from
  git.
- Refactored the inherited `FuelContext` to use local mock data instead of the
  Replit API fallback.
- Added shared self/served service-mode state across filters, list cards, and
  map markers.
- Added a FuelRadar dataset model and adapter from FuelRadar station/price rows
  to the current UI `GasStation` shape.
- Added `scripts/generate-mimit-sample.ts` and generated a Rome-area MIMIT
  sample dataset for the app.
- Connected `FuelContext` to the generated MIMIT sample dataset.

## In Progress

- App shell runs from the Fuel-Finder base and uses local mock station data.
- UI direction is close to the preferred Replit prototype, but needs testing on
  iPhone and refinement after real data integration.

## Next

- Make selected fuel and service-mode state fully reflected in station detail
  sheet copy and actions.
- Keep favorite stations and saved places local with AsyncStorage.
- Add dataset metadata state: extraction date, refresh status, and last import
  result.
- Decide whether the next persistence step is:
  - regenerate static samples during development;
  - or move directly to SQLite import/cache.

## Later

- Implement MIMIT download inside the app.
- Implement metadata-aware refresh using `ETag` and `Last-Modified`.
- Import stations and prices into SQLite.
- Query nearby stations from SQLite with bounding-box filtering and Haversine
  distance.
- Add configurable radius from 5 km to 50 km.
- Add city/place search for usage without GPS.
- Add station detail actions, including opening native maps.
- Add real favorite places UI.
- Add offline states and empty states for missing local data.
- Add route planning in a later phase.

## Local Cleanup

- `Fuel-Finder/` can be removed after confirming the migrated app still works.
- `.expo/` can be removed any time; Expo recreates it.
- `node_modules/` can be removed and recreated with `bun install`.
- `data/mimit/` should be kept if local data scripts are still useful.
