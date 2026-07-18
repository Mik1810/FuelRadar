# FuelRadar Web Roadmap

## Product Direction

FuelRadar is a mobile-first Italian web application for finding nearby fuel
stations and comparing the latest official prices. The former Expo application
has been abandoned in favor of a web architecture that can later become an
installable PWA.

Confirmed product decisions:

- Italy and Italian municipalities first;
- no user accounts;
- browser-local preferences, favorites and last usable GPS position;
- GPS requested while the site is in use, with manual municipality search as a
  fallback;
- map and ranked list as the core experience;
- latest official MIMIT daily dataset as the source of truth;
- PWA installation is important, but follows the MVP;
- white and sage-green visual direction, keeping the existing FuelRadar logo;
- no analytics or non-essential cookies in the initial release.

## Stack

- Next.js, React and TypeScript;
- Bun for package management and scripts;
- Vercel for builds, hosting and scheduled jobs;
- Supabase PostgreSQL with PostGIS, isolated in the `fuelradar` schema;
- Leaflet/React Leaflet with OpenStreetMap-compatible tiles;
- static ISTAT municipality data for browser-side autocomplete;
- `localStorage` for preferences, favorites and last position.

Production is served from `fuelradar.michaelpiccirilli.it`.

## Architecture

```text
MIMIT daily CSV files
        |
        v
Vercel scheduled importer
  - download both resources
  - validate format and extraction date
  - normalize stations and prices
  - stage and publish atomically
        |
        v
Supabase PostgreSQL/PostGIS (fuelradar schema)
        |
        v
Next.js public read API
  - nearby stations
  - station detail
  - dataset status
        |
        v
Mobile-first web UI
  - GPS or municipality
  - Leaflet map and ranked list
  - local preferences/favorites
```

Code boundaries:

- `src/domain/`: framework-independent canonical model and pure parsers;
- `src/server/`: server-only downloads, database access and imports;
- `src/app/`: routes, API handlers and UI;
- browser storage and geolocation remain client-side and never enter the import
  domain.

## Dataset Rules

- The price file extraction date identifies the published daily dataset.
- Station and price resources must have the same extraction date.
- A price can remain valid when `dtComu` predates the extraction date; it is the
  operator communication time, not an expiry date.
- Unsupported fuels and invalid values are skipped with explicit diagnostics.
- A failed import never replaces the last successful dataset.
- The UI must expose dataset freshness without implying that every price was
  communicated on the extraction day.

See `DATA_SOURCE.md` for the field-level contract.

## Delivery Order

The GitHub roadmap is tracked by epic #37 and issues #38–#54.

### 1. Architecture foundation

- migrate the Expo foundation to Next.js (#38, complete);
- extract the canonical domain and MIMIT parser (#39);
- configure Supabase migrations (#40);
- design PostgreSQL/PostGIS schema and geographic queries (#41);
- implement atomic, idempotent MIMIT import (#42);
- schedule and monitor imports with Vercel Cron (#43);
- expose the public read API (#44);
- generate static municipality autocomplete data (#45);
- implement browser GPS and local preferences (#46).

### 2. MVP experience

- build the mobile-first application shell (#47);
- integrate Leaflet and configurable free tiles (#48);
- add filters, municipality search and ranked station list (#49);
- add station details, favorites and directions (#50).

### 3. Refinement and release

- refine the sage visual system and accessibility (#51);
- add end-to-end tests and CI (#52);
- finalize Vercel, Supabase and custom-domain operations (#53);
- add installable PWA behavior and last-zone cache (#54).

## Deferred

- accounts and cross-device synchronization;
- analytics and marketing cookies;
- full-text address/place providers beyond static municipalities;
- route-aware station search;
- notifications and historical price analysis.
