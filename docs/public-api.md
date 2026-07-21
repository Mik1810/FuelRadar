# FuelRadar frontend API

These same-origin endpoints are the only browser-facing boundary for station
data. They run on the server and never expose `DATABASE_URL`, Supabase roles or
other credentials. They are an application contract, not a versioned API for
third parties.

All success bodies use camelCase. Every failure uses:

```json
{
  "error": {
    "code": "invalid_input",
    "message": "Invalid nearby search parameters."
  }
}
```

Errors are never cached and never contain SQL, configuration values or raw
validation details.

## Nearby stations

```http
GET /api/stations/nearby?latitude=41.9028&longitude=12.4964&radiusKm=10&fuelType=benzina&serviceMode=self&limit=50
```

`latitude`, `longitude`, `fuelType` and `serviceMode` are required. `radiusKm`
defaults to `10` and is limited to `0.1..50`; `limit` defaults to `50` and is
limited to `1..200`. Fuel is one of `benzina`, `diesel`, `gpl`, `metano` and
service is `self` or `served`. Unknown, repeated, blank or malformed parameters
return HTTP 400 before any database query.

```json
{
  "data": {
    "extractionDate": "2026-07-20",
    "stations": [
      {
        "id": "12345",
        "operator": "Example operator",
        "brand": "Example brand",
        "stationType": "Stradale",
        "name": "Example station",
        "address": "Via Roma 1",
        "city": "Roma",
        "province": "RM",
        "latitude": 41.9028,
        "longitude": 12.4964,
        "fuelType": "benzina",
        "serviceMode": "self",
        "price": 1.699,
        "communicatedAt": "2026-07-20T08:30:00",
        "distanceKm": 1.25
      }
    ]
  }
}
```

Results are ordered by price, then distance, then station ID. An empty match is
HTTP 200 with `stations: []`. Because the URL contains a precise position, the
response is browser-private and revalidates after at most 60 seconds.

## Station detail

```http
GET /api/stations/12345
```

```json
{
  "data": {
    "extractionDate": "2026-07-20",
    "station": {
      "id": "12345",
      "operator": "Example operator",
      "brand": "Example brand",
      "stationType": "Stradale",
      "name": "Example station",
      "address": "Via Roma 1",
      "city": "Roma",
      "province": "RM",
      "latitude": 41.9028,
      "longitude": 12.4964,
      "prices": [
        {
          "fuelType": "diesel",
          "serviceMode": "self",
          "price": 1.65,
          "communicatedAt": "2026-07-20T09:00:00"
        }
      ]
    }
  }
}
```

Prices belong only to the active dataset and are ordered by fuel and service.
MIMIT communication timestamps are Italian civil times and intentionally have
no fabricated UTC suffix. An unknown station returns HTTP 404.

## Dataset status

```http
GET /api/dataset/status
```

```json
{
  "data": {
    "extractionDate": "2026-07-20",
    "stationsExtractionDate": "2026-07-20",
    "pricesExtractionDate": "2026-07-20",
    "importedAt": "2026-07-20T09:01:00.000Z",
    "activatedAt": "2026-07-20T09:01:01.000Z",
    "stationCount": 23946,
    "priceCount": 74968,
    "freshness": {
      "ageDays": 1,
      "status": "fresh"
    },
    "latestImport": {
      "status": "succeeded",
      "startedAt": "2026-07-20T09:00:00.000Z",
      "finishedAt": "2026-07-20T09:01:01.000Z",
      "durationMs": 61000
    }
  }
}
```

Freshness uses calendar days in `Europe/Rome`. Today and yesterday are fresh;
older extraction dates are stale. Future source dates are clamped to age zero.
Import error text and source fingerprints are not public.

## Status and caching

- HTTP 400 `invalid_input`: request shape or bounds are invalid.
- HTTP 404 `station_not_found`: active dataset exists, station does not.
- HTTP 503 `dataset_unavailable`: no active dataset exists.
- HTTP 500 `internal_error`: sanitized server failure.

Station-detail and dataset-status successes use a five-minute shared-cache TTL
with one minute of stale-while-revalidate. Nearby results use a private
one-minute browser cache. A newly activated daily dataset is therefore visible
without a deploy or manual cache invalidation. Error responses use `no-store`.
