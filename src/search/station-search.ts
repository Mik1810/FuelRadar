import {
  getDatasetFreshness,
  nearbyResponseSchema,
  type DatasetStatus,
  type PublicNearbyStation,
} from "@/domain/public-api";
import { nearbySearchSchema } from "@/domain/nearby";
import type { FuelType, ServiceMode } from "@/domain/fuel";
import { createPriceMarker, type PriceMarker } from "@/map/price-marker";

export const SEARCH_RADIUS_MIN_KM = 5;
export const SEARCH_RADIUS_MAX_KM = 50;
export const SEARCH_LIMIT = 200;

export function normalizeSearchRadiusKm(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.min(SEARCH_RADIUS_MAX_KM, Math.max(SEARCH_RADIUS_MIN_KM, value));
}

export type SearchOrigin = Readonly<{
  latitude: number;
  longitude: number;
}>;

export type StationSearchInput = Readonly<{
  origin: SearchOrigin;
  radiusKm: number;
  fuelType: FuelType;
  serviceMode: ServiceMode;
}>;

export type StationSearchResult = Readonly<{
  extractionDate: string;
  freshness: DatasetStatus["freshness"];
  stations: readonly PublicNearbyStation[];
}>;

export type StationSearchFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type StationSearchState =
  | { status: "idle"; requestId: number }
  | { status: "loading"; requestId: number }
  | { status: "ready"; requestId: number; result: StationSearchResult }
  | { status: "empty"; requestId: number; result: StationSearchResult }
  | { status: "error"; requestId: number; message: string };

export type StationSearchAction =
  | { type: "start"; requestId: number }
  | { type: "success"; requestId: number; result: StationSearchResult }
  | { type: "failure"; requestId: number; message: string };

export const INITIAL_STATION_SEARCH_STATE: StationSearchState = {
  status: "idle",
  requestId: 0,
};

export function viewportCenterChanged(
  current: SearchOrigin | null,
  next: SearchOrigin,
  tolerance = 0.000_01,
): boolean {
  return (
    current === null ||
    Math.abs(current.latitude - next.latitude) >= tolerance ||
    Math.abs(current.longitude - next.longitude) >= tolerance
  );
}

/** The API is the single source of truth for its stable price/distance/id order. */
export function stationSearchReducer(
  state: StationSearchState,
  action: StationSearchAction,
): StationSearchState {
  if (action.type === "start") {
    return { status: "loading", requestId: action.requestId };
  }
  if (action.requestId !== state.requestId) return state;
  if (action.type === "failure") {
    return { status: "error", requestId: action.requestId, message: action.message };
  }
  return {
    status: action.result.stations.length === 0 ? "empty" : "ready",
    requestId: action.requestId,
    result: action.result,
  };
}

function validateSearchInput(input: StationSearchInput) {
  return nearbySearchSchema.parse({
    ...input.origin,
    radiusKm: input.radiusKm,
    fuelType: input.fuelType,
    serviceMode: input.serviceMode,
    limit: SEARCH_LIMIT,
  });
}

/** Builds a same-origin request only from an already validated client input. */
export function buildNearbySearchUrl(
  input: StationSearchInput,
  baseUrl: string,
): URL {
  const search = validateSearchInput(input);
  if (
    search.radiusKm < SEARCH_RADIUS_MIN_KM ||
    search.radiusKm > SEARCH_RADIUS_MAX_KM
  ) {
    throw new RangeError("Search radius must be between 5 and 50 km.");
  }
  const base = new URL(baseUrl);
  const url = new URL("/api/stations/nearby", base.origin);
  url.search = new URLSearchParams({
    latitude: String(search.latitude),
    longitude: String(search.longitude),
    radiusKm: String(search.radiusKm),
    fuelType: search.fuelType,
    serviceMode: search.serviceMode,
    limit: String(SEARCH_LIMIT),
  }).toString();
  return url;
}

async function parseResponse(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error("Impossibile caricare i distributori.");
  try {
    return await response.json();
  } catch {
    throw new Error("La risposta dei distributori non è valida.");
  }
}

export async function fetchStationSearch(
  input: StationSearchInput,
  options: {
    fetcher?: StationSearchFetcher;
    signal?: AbortSignal;
    baseUrl?: string;
    now?: Date;
  } = {},
): Promise<StationSearchResult> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? globalThis.location?.origin;
  if (!baseUrl) throw new Error("Manca un'origine per la ricerca.");
  const nearbyUrl = buildNearbySearchUrl(input, baseUrl);
  const nearby = await fetcher(nearbyUrl, {
    signal: options.signal,
    credentials: "same-origin",
  });
  const payload = nearbyResponseSchema.safeParse(await parseResponse(nearby));
  if (!payload.success) throw new Error("La risposta dei distributori non è valida.");
  const extractionDate = payload.data.data.extractionDate;
  return {
    extractionDate,
    freshness: getDatasetFreshness(extractionDate, options.now),
    stations: payload.data.data.stations,
  };
}

/** Produces map models in precisely the same sequence as the rendered results. */
export function stationResultMarkers(
  stations: readonly PublicNearbyStation[],
): readonly PriceMarker[] {
  return stations.flatMap((station) => {
    const marker = createPriceMarker({
      id: station.id,
      latitude: station.latitude,
      longitude: station.longitude,
      name:
        station.name ||
        station.brand ||
        station.operator ||
        `Distributore ${station.id}`,
      address: station.address,
      price: station.price,
      fuelType: station.fuelType,
      serviceMode: station.serviceMode,
      distanceKm: station.distanceKm,
    });
    return marker ? [marker] : [];
  });
}
