# Mobile-first MVP shell

The home page provides the stable layout and state contract used by the map and
station-search features. It deliberately does not fetch station data or load a
map provider yet.

## Layout

- one server-rendered page with a client-side shell for browser state;
- a compact header with the existing FuelRadar logo and page navigation;
- a map region with a persistent results panel;
- a bottom sheet on mobile and the same panel as a desktop sidebar;
- a skip link, one `main` landmark and one page heading.

The shell supports a 320 px viewport without horizontal scrolling. Interactive
targets are at least 44 px high, keyboard focus remains visible, and reduced
motion preferences disable non-essential animation.

## State contract

`resolveShellViewState` maps browser connectivity, geolocation state and the
preferred search origin to these UI states:

- `initial`: choose GPS or, once the search controls land, a municipality;
- `loading`: a geolocation request is in progress;
- `ready`: a saved or current search origin is available;
- `error`: geolocation is unavailable or denied and can be retried;
- `offline`: current map and price data cannot be loaded;
- `empty`: a completed station search returned no results.

Errors and offline changes use an assertive live region. Other state changes use
a polite status region and loading exposes `aria-busy`. A successful GPS request
started from the CTA moves focus to the named results panel; automatic permission
resume never steals focus.

## Follow-up integration

Issue #48 replaces only the map placeholder with the Leaflet map. Issue #49
connects the municipality selector, filters, station API and results list to the
existing panel and makes the `empty` state reachable at runtime. Those features
should preserve the current landmarks, focus order and responsive panel DOM.
