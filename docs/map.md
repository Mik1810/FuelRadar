# Leaflet map

FuelRadar loads the Leaflet map only in the browser. The page and its results
sheet remain server-renderable, so browser APIs and Leaflet are not evaluated
during SSR.

## Tile provider

`src/map/config.ts` owns tile-provider configuration. The map receives that
provider through a prop; it does not select a tile provider internally. The
default is the exact OpenStreetMap standard tile URL:

`https://tile.openstreetmap.org/{z}/{x}/{y}.png`

It uses zoom levels 0 through 19 and renders the configured, linked OpenStreetMap
attribution in Leaflet's visible attribution control. The control sits at the
top left, outside the desktop sidebar and above the mobile results sheet.

This default requires no key or billing setup, but it is subject to the
[OpenStreetMap Foundation tile usage policy](https://operations.osmfoundation.org/policies/tiles/):
there is no availability guarantee, the application does not prefetch tiles,
and it does not set a restrictive referrer policy. A production tile provider
can replace the configuration object with an HTTPS URL containing `{z}`, `{x}`
and `{y}`, explicit zoom limits, and visible HTTPS attribution links. Do not
move provider selection into the map component.

## Boundaries and failure behaviour

The map renders a saved/current GPS position independently from the active
search center, so a municipality search can still show the device's last known
location. It also renders the active center and fits its configured radius above
the mobile results sheet or beside the desktop panel. Price labels are derived
from numeric prices inside the renderer and inserted as DOM text. The map
accepts reusable price-marker models and clusters them with
`react-leaflet-cluster`, but it creates no sample station data and makes no API
request. Issue #49 can connect its debounced `moveend` viewport callback to the
nearby-stations query.

If one or more tiles fail, the map explains the failure in a non-blocking,
announced overlay with a retry control that recreates the tile layer. The rest
of the shell, location action, and results panel remain usable.
