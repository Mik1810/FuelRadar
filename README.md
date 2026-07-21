# FuelRadar

FuelRadar is a mobile-first web application for finding fuel stations and
comparing official fuel prices in Italy.

The project uses a web-first stack:

- Next.js and TypeScript;
- Supabase PostgreSQL with PostGIS;
- Vercel hosting and scheduled MIMIT imports;
- React Leaflet with OpenStreetMap data;
- browser-local preferences, favorites, and last known position.

## Requirements

- Bun 1.3 or newer.

## Local development

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
bun run lint
bun run typecheck
bun test
bun run build
```

## Environment

Copy `.env.example` to `.env.local` and fill in the server-only values.
Never commit `.env.local` or expose database credentials through variables
prefixed with `NEXT_PUBLIC_`.

Database setup, connection roles and migration commands are documented in
[`docs/database.md`](docs/database.md).
The server-only frontend API contract is documented in
[`docs/public-api.md`](docs/public-api.md).
The reproducible static municipality catalog is documented in
[`docs/municipalities.md`](docs/municipalities.md).
Browser-only preferences and GPS lifecycle are documented in
[`docs/browser-state.md`](docs/browser-state.md).
The responsive home layout and its accessible state contract are documented in
[`docs/mvp-shell.md`](docs/mvp-shell.md).
The client-only Leaflet boundary, provider policy, and map failure behaviour are
documented in [`docs/map.md`](docs/map.md).
Station-search filters, validation, freshness labels, and list/marker behaviour
are documented in [`docs/station-search.md`](docs/station-search.md).

## Data source

FuelRadar uses the official daily MIMIT station registry and price datasets.
See `DATA_SOURCE.md` for the current format and normalization rules.
