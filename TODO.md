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
- Added initial Expo SQLite setup with local station, price, and dataset
  metadata tables.
- Added SQLite import/read flow for the generated sample dataset.
- Split SQLite infrastructure into database, DAO, and repository modules.
- Added SQLite nearby dataset queries by fuel, service mode, radius, and map
  center.
- Connected nearby SQLite queries to the visible map camera center.
- Added a MIMIT metadata client and repository check that stores remote CSV
  `ETag`, `Last-Modified`, and size metadata.
- Added local-vs-remote MIMIT metadata status comparison before CSV download.
- Added MIMIT CSV download and base validation for extraction date and headers.
- Added conversion from validated MIMIT CSV rows into `FuelRadarDataset`.
- Added metadata-aware MIMIT refresh that imports downloaded datasets into
  SQLite only after remote data changes.
- Serialized MIMIT refresh/import calls so concurrent startup and tab loads do
  not run overlapping SQLite operations.
- Added list/favorites navigation to focus a selected station on the map.
- Added bounded marker clustering on the native map to keep the visible marker
  count near 20 while splitting clusters with zoom.
- Added configurable search radius controls from 5 to 50 km.
- Added an Impostazioni tab with radius stepper controls, dataset status,
  counts, and
  manual refresh.
- Aligned the location picker across map, list, and favorites headers.
- Raised the map header touch priority so filter chips stay tappable over the
  native map.
- Replaced the marker cluster grid fallback with progressive splitting so
  clusters keep decomposing as the map zooms in.
- Restored Liquid Glass/native tabs after the touch debugging attempt.
- Separated the favorite button responder from the station card navigation tap.
- Kept the native map mounted in the map tab and positioned it below the filter
  header to avoid marker redraws when leaving and returning to the map.
- Separated MIMIT remote refresh from local SQLite queries so filter, radius,
  and map-center changes do not trigger network checks.
- Updated cluster taps to set the zoom region immediately and focus the cluster
  bounds so markers split more predictably.
- Kept favorite stations backed by direct SQLite station-id lookups so the
  Favorites list does not depend on the current map query.
- Offset list/favorites map focusing and render the selected marker separately
  so the marker remains visible above the detail sheet.
- Refresh the current local query when favorites change and keep an optimistic
  favorite row from in-memory station data while the DB lookup completes.

## In Progress

- App shell runs from the Fuel-Finder base and uses local SQLite station data.
- UI direction is close to the preferred Replit prototype, but needs testing on
  iPhone and refinement after real data integration.
- SQLite is initialized at app startup, refreshed from MIMIT when metadata
  changes, and read back before updating the UI.

## Next

- Make selected fuel and service-mode state fully reflected in station detail
  sheet copy and actions.
- Keep favorite stations and saved places local with AsyncStorage.
- Add dataset metadata state: refresh status and last import result.

## Later

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
