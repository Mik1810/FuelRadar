# Station search

The home search starts only after the user chooses a municipality or permits a
GPS location. It stores fuel (`benzina`, `diesel`, `gpl`, `metano`), service
mode (`self`, `served`), and a 5–50 km radius in the existing browser
preference store.

The municipality combobox creates its local provider only after a two-character
query. Its catalog request is delayed briefly and late responses are ignored.
The keyboard contract is Arrow Up/Down to choose a suggestion, Enter to select
it, and Escape to close suggestions.

Nearby requests are always same-origin requests to `/api/stations/nearby`, are
limited to 200 records, and validate `nearbyResponseSchema` before rendering.
An in-flight request is aborted when a filter, origin, or the debounced map
viewport center changes; a request ID reducer also rejects late results. The
saved GPS/municipality remains the browser preference, while panning only moves
the active query center and its green search circle—there is no `fitBounds`
feedback loop.

The client does not sort responses: the API's stable price, distance, then ID
ordering is used identically for the list and map markers. Selecting a result
opens its corresponding marker popup; selecting a marker moves accessible focus
to its result. Each response shows its extraction date, stale status when
applicable, and the station-specific price communication timestamp.
