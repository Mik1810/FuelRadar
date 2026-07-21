# Browser preferences and location

FuelRadar keeps user preferences only in the browser. Nothing in this state is
sent to a user profile or synchronized between devices.

## Persisted contract

`src/browser/preferences.ts` owns the versioned
`fuelradar:preferences` document. Version 1 stores:

- fuel type, service mode and search radius;
- up to 500 canonical station favorites (letters, numbers, `.`, `_` and `-`);
- the selected municipality and its representative coordinates;
- the last valid GPS latitude, longitude, accuracy in metres and capture time;
- the active location mode, so choosing a municipality is not silently
  overridden by an older GPS fix.

Every field is bounded and validated as one document. Missing storage uses safe
defaults. Invalid JSON, unsupported versions, duplicate or invalid favorites,
impossible coordinates, future timestamps and oversized documents are removed
and reset to defaults. Storage security/quota errors never stop the app: valid
updates continue in memory for the current visit.

A GPS fix remains available as a fallback on the next visit. Its freshness is
explicit: up to and including 15 minutes is `current`, and anything older is
`stale`. Consumers must show stale data as the last known position, including
its capture time and accuracy, rather than presenting it as a live fix.
`useGpsFreshness()` schedules a render immediately after the 15-minute
boundary, so an open page cannot keep an expired fix labelled as current when
no new GPS callback arrives.

## Hydration and GPS lifecycle

`BrowserStateBootstrap` is a zero-markup Client Component mounted by the server
layout. Server rendering and the first hydration snapshot always use the same
defaults. `window.localStorage`, `navigator.permissions` and
`navigator.geolocation` are accessed only after hydration or a direct user
action.

Startup only calls `watchPosition` when the optional Permissions API reports
that geolocation is already granted and GPS is the saved active mode. A
`prompt` result, missing Permissions API or query failure never triggers a
permission prompt. `requestBrowserGeolocation()` calls `watchPosition`
synchronously and is intended to be invoked directly by the GPS button handler,
which preserves user activation on Safari.

The watcher is idempotent, persists every newer valid fix, and is cleared on
unmount, permission revocation, or manual municipality selection. Permission
denied, unavailable, timeout, insecure-context and unsupported-API states are
separate public states. Transient failures and invalid callbacks preserve the
last valid position.

Geolocation requires HTTPS in production. Safari may not expose a reliable
Permissions API result before a geolocation request, so callback error codes
remain authoritative and the app continues to support municipality selection
without GPS.
