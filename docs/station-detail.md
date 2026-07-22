# Station detail and favorites

Selecting either a result or its map marker opens the same native modal dialog.
The browser fetches `/api/stations/:id` only when the detail is opened and
validates the complete response before rendering it. In-flight requests are
aborted on selection changes and a request ID prevents late responses from
replacing the active detail.

The sheet shows the station identity and address, distance when the station is
part of the current nearby result, every communicated fuel/service price and
its communication timestamp. The dataset extraction date is always visible and
is labelled when stale. Google Maps directions use only validated response
coordinates; the Apple Maps option appears only on compatible Apple clients.

Favorites are canonical station IDs stored in the existing versioned browser
preferences, with a maximum of 500. Their list remains available when no nearby
query is active and details are fetched on demand rather than prefetched. A
deleted or currently missing station is reported clearly and remains stored
until the user explicitly removes it, so a transient dataset change cannot
silently corrupt the list.

The native `dialog` supplies focus containment and Escape semantics. FuelRadar
returns focus to the invoking control and adds one history entry when opening;
the browser Back action closes the dialog without creating navigation loops.
