import type { NearbySearch } from "@/domain/nearby";
import { nearbySearchSchema } from "@/domain/nearby";
import {
  nearbyResponseSchema,
  type NearbyStationsResult,
} from "@/domain/public-api";
import {
  errorResponse,
  jsonResponse,
  logPublicApiFailure,
  NEARBY_CACHE_CONTROL,
} from "@/app/api/public-response";

const ALLOWED_QUERY_PARAMETERS = new Set([
  "latitude",
  "longitude",
  "radiusKm",
  "fuelType",
  "serviceMode",
  "limit",
]);

export type NearbyHandlerDependencies = {
  getNearbyStations: (search: NearbySearch) => Promise<NearbyStationsResult>;
};

function singleValue(searchParams: URLSearchParams, name: string) {
  const values = searchParams.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

function decimalValue(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return Number.NaN;
  return Number(value);
}

function parseNearbySearch(url: URL): NearbySearch | null {
  if ([...url.searchParams.keys()].some((key) => !ALLOWED_QUERY_PARAMETERS.has(key))) {
    return null;
  }
  if (
    [...ALLOWED_QUERY_PARAMETERS].some(
      (key) => url.searchParams.getAll(key).length > 1,
    )
  ) {
    return null;
  }

  const latitude = singleValue(url.searchParams, "latitude");
  const longitude = singleValue(url.searchParams, "longitude");
  const fuelType = singleValue(url.searchParams, "fuelType");
  const serviceMode = singleValue(url.searchParams, "serviceMode");
  const radiusKm = singleValue(url.searchParams, "radiusKm");
  const limit = singleValue(url.searchParams, "limit");

  const parsed = nearbySearchSchema.safeParse({
    latitude: decimalValue(latitude),
    longitude: decimalValue(longitude),
    fuelType,
    serviceMode,
    radiusKm: decimalValue(radiusKm),
    limit: decimalValue(limit),
  });

  return parsed.success ? parsed.data : null;
}

export async function handleNearbyStations(
  request: Request,
  dependencies: NearbyHandlerDependencies,
) {
  const search = parseNearbySearch(new URL(request.url));
  if (!search) {
    return errorResponse(
      "invalid_input",
      "Invalid nearby search parameters.",
      400,
    );
  }

  try {
    const result = await dependencies.getNearbyStations(search);
    if (result.status === "dataset-unavailable") {
      return errorResponse(
        "dataset_unavailable",
        "No active fuel dataset is available.",
        503,
      );
    }

    return jsonResponse(
      nearbyResponseSchema.parse({
        data: {
          extractionDate: result.extractionDate,
          stations: result.stations,
        },
      }),
      200,
      NEARBY_CACHE_CONTROL,
    );
  } catch {
    logPublicApiFailure("stations_nearby");
    return errorResponse("internal_error", "Unable to load nearby stations.", 500);
  }
}
