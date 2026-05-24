# FuelRadar Roadmap

## Vision

FuelRadar is a mobile app for finding the cheapest recent fuel prices in Italy.
The first target platform is iPhone, while keeping the codebase cross-platform
through React Native and Expo.

The product priority is simple:

- show trustworthy fuel prices;
- make nearby stations easy to compare;
- work with or without GPS permission;
- keep the MVP small enough to validate the official data source before adding
  backend infrastructure.

## Confirmed Decisions

- Country: Italy only.
- App stack: React Native, Expo, TypeScript.
- Maps: native maps, with iOS as the primary target.
- Backend: not part of the MVP.
- Local storage: SQLite.
- Data source: official MIMIT open data for fuel stations and prices.
- Price freshness: show prices from the latest daily MIMIT dataset.
- Default fuel mode: benzina self.
- Self and served prices: shown as separate options.
- Initial search radius: 10 km.
- Configurable search radius: 5 km to 50 km.
- Default ordering: lowest price first.
- Initial screen: map.
- Favorites: both places and fuel stations.
- GPS: optional; the app must also work through place, city, or favorite search.
- Data refresh: check on app startup, avoid re-downloading unchanged data, and
  support manual pull-to-refresh.
- Routes: planned for a future phase, outside the MVP.

## Technology Stack

The MVP should use a mobile-first stack that keeps the iPhone experience strong
without giving up cross-platform support.

Core stack:

- React Native for the mobile app;
- Expo for project setup, native builds, and device APIs;
- TypeScript for application code;
- Expo Router for navigation;
- `react-native-maps` for native maps;
- `expo-location` for GPS and permission handling;
- `expo-sqlite` for local data storage;
- React state and Context for MVP-level app state;
- custom React Native components for the UI;
- `lucide-react-native` for icons when an icon is needed.

Data handling:

- use `fetch` for downloading MIMIT files;
- use HTTP cache metadata such as `ETag` or `Last-Modified` when available;
- fall back to local dataset metadata when the remote source does not expose
  reliable cache headers;
- use a robust CSV parser if the MIMIT files contain edge cases that make a
  small custom parser risky;
- normalize imported data before writing it to SQLite.

Geospatial search:

- use SQLite to narrow candidates by bounding box;
- calculate exact distance in TypeScript with the Haversine formula;
- filter by the configured radius;
- sort visible results by selected fuel price.

Testing focus:

- parser and MIMIT field normalization;
- latest-dataset price filtering;
- fuel and service-mode mapping;
- distance calculation;
- SQLite import and query behavior;
- manual verification on iPhone or iOS simulator for maps and UI.

The first implementation spike should validate whether downloading, parsing, and
querying the official MIMIT data directly on device is fast enough. If not, the
future backend can take over import and geospatial queries while keeping the app
UX unchanged.

## Data Source

FuelRadar should use the official MIMIT fuel open data:

- fuel station registry;
- fuel prices;
- station coordinates, when available;
- update timestamp for each price, when available.

Operational data-source details are tracked in `DATA_SOURCE.md`.

The MVP should treat the downloaded daily dataset as the source of truth. If a
station does not have a price in the latest dataset for the selected fuel and
service mode, it should not appear in the main map or list results.

The first technical risk to validate is whether the app can download, parse, and
query the MIMIT files directly on device with acceptable performance. If this is
too heavy, a backend cache can be introduced later without changing the product
model.

## MVP Scope

The MVP should include:

- map centered on the user's location, selected place, or favorite;
- fuel stations within the configured radius;
- marker price for the selected fuel and service mode;
- fuel selector;
- self/served selector;
- station list sorted by lowest price;
- station detail screen;
- latest-dataset price filtering;
- local SQLite cache;
- app-start data refresh check;
- manual pull-to-refresh;
- offline use with the last valid downloaded dataset;
- favorite places;
- favorite fuel stations;
- opening a selected station in the native maps app.

The MVP should not include:

- user accounts;
- cloud sync;
- push notifications;
- route planning;
- user-submitted prices;
- historical price charts;
- custom backend services.

## UI Direction

The initial UI direction is based on the prototypes in `images/`:

- `images/map.jpg`;
- `images/list.jpg`;
- `images/preferences.jpg`.

The app should feel iPhone-first, with a dark interface and a map-led workflow.
The visual style should be functional, compact, and optimized for quick price
comparison.

Core UI patterns:

- dark theme as the primary visual mode;
- orange accent color for selected fuel, best price, and active price markers;
- cyan accent for the active bottom navigation item;
- top area with a zone selector, shown as "Seleziona zona";
- horizontal fuel selector chips for Benzina, Diesel, Metano, and GPL;
- native map as the main surface on the map screen;
- price markers displayed directly on the map;
- floating current-location button on the map;
- floating bottom navigation with Mappa, Lista, and Preferiti;
- heart icon for favorite stations;
- list cards with station brand, name, address, rank, price, unit, secondary
  fuel badges, and update time;
- first result can be highlighted as "Piu conveniente";
- favorites screen should include a clear empty state when no favorite station is
  saved.

The MVP UI should keep the same main information architecture:

- Map tab: geographic discovery and price markers.
- List tab: ranked comparison by lowest selected fuel price.
- Favorites tab: saved stations and, later, saved places.

## Data Rules

- A price is valid when it belongs to the latest downloaded daily MIMIT dataset.
- A station is visible only when it has a valid price for the selected fuel and
  selected service mode.
- Self and served prices are separate results.
- The UI should clearly show the dataset extraction date and the price
  communication time from `dtComu` when available.
- If the app is offline, it may show the last valid dataset, but it must make the
  dataset date visible.
- Manual refresh should never erase the last valid local data if the new download
  fails.

## Proposed Data Model

```ts
type FuelType = "benzina" | "diesel" | "gpl" | "metano";

type ServiceMode = "self" | "served";

type FuelStation = {
  id: string;
  name: string;
  brand?: string;
  address: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
  roadType?: string;
};

type FuelPrice = {
  stationId: string;
  fuelType: FuelType;
  serviceMode: ServiceMode;
  price: number;
  updatedAt: string;
};

type FavoritePlace = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
};

type FavoriteStation = {
  stationId: string;
};
```

The real implementation should adapt these fields to the exact MIMIT data shape.

## Phase 0: Validate MIMIT Data

Goal: prove that the official data can support the MVP.

Tasks:

- download the current station registry and price files;
- verify CSV format, separator, encoding, and field names;
- confirm coordinate availability and quality;
- confirm how fuel names and self/served modes are represented;
- confirm price timestamp format;
- estimate file sizes;
- build a small parser prototype;
- test filtering for prices from the latest dataset;
- test basic geospatial filtering around a coordinate.

Exit criteria:

- the app data model can be mapped from MIMIT fields;
- the expected SQLite tables are known;
- there is a clear answer on whether direct on-device import is acceptable for
  the MVP.

## Phase 1: App Skeleton

Goal: create the basic Expo app structure.

Tasks:

- initialize Expo with TypeScript;
- configure app navigation;
- add native map support;
- add location permission flow;
- add SQLite storage;
- create base screens:
  - map;
  - list;
  - station detail;
  - favorites;
  - settings.

Exit criteria:

- the app runs on iOS simulator or iPhone;
- the map screen is the first screen;
- navigation between placeholder screens works.

## Phase 2: Map And List With Demo Data

Goal: validate the core user experience before integrating real data.

Tasks:

- load a small local demo station dataset;
- display station markers on the map;
- show selected fuel price on markers;
- add fuel selector;
- add self/served selector;
- add radius setting from 5 km to 50 km;
- default radius to 10 km;
- sort list by lowest price;
- create station detail view;
- open selected station in native maps.

Exit criteria:

- the user can compare nearby demo stations by price;
- changing fuel, service mode, or radius updates map and list results.

## Phase 3: Real Data Import

Goal: replace demo data with official MIMIT data.

Tasks:

- implement MIMIT download;
- avoid re-downloading unchanged files when possible;
- import registry and price data into SQLite;
- keep the last valid dataset if refresh fails;
- filter results to prices from the latest dataset only;
- add manual pull-to-refresh;
- show dataset date and refresh state;
- support offline startup using cached data.

Exit criteria:

- the app displays real fuel prices from the latest daily MIMIT dataset;
- startup refresh does not repeatedly download unchanged data;
- manual refresh works without risking local cached data.

## Phase 4: Search Without GPS

Goal: make the app useful when location permission is denied or unavailable.

Tasks:

- add city or place search;
- center the map on the selected place;
- query stations within the configured radius;
- save the last selected search area;
- use a favorite place as a search center;
- handle denied location permission cleanly.

Exit criteria:

- the app works without GPS access;
- users can still search prices near a city, place, or favorite.

## Phase 5: Favorites

Goal: support repeated daily use.

Tasks:

- save favorite places;
- save favorite fuel stations;
- edit and remove favorite places;
- remove favorite stations;
- search prices near a favorite place;
- show favorite station status in station detail.

Exit criteria:

- users can quickly check prices around home, work, or another saved place;
- users can keep a short list of stations they care about.

## Phase 6: MVP Polish

Goal: make the app stable enough for real personal use.

Tasks:

- add loading states;
- add empty states;
- add download and parsing error states;
- improve offline messaging;
- verify dark mode;
- test marker performance with realistic data volume;
- test on iPhone or iOS simulator;
- review privacy copy for location permission.

Exit criteria:

- the MVP is usable on iPhone;
- common failure modes are handled without data loss.

## Future Phase: Routes

Route planning is intentionally outside the MVP.

Future capabilities:

- enter origin and destination;
- save frequent routes;
- find stations close to the route;
- configure maximum route deviation;
- sort route stations by price, deviation, or both;
- open navigation to the selected station.

The routing provider should be selected later. Options include native map
capabilities, Google Directions, OpenRouteService, OSRM, or GraphHopper.

## Future Phase: Backend

A backend should be introduced only if the direct-on-device approach is not good
enough.

Reasons to add a backend:

- MIMIT files are too large or slow to parse on device;
- geospatial queries become too expensive locally;
- scheduled server-side imports are needed;
- push notifications are added;
- cloud sync is added;
- historical price analysis is added.

Possible backend stack:

- Node.js with Fastify;
- PostgreSQL with PostGIS;
- scheduled MIMIT import job;
- mobile API optimized for nearby station and route queries.
