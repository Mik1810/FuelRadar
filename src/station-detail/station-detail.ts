import {
  getDatasetFreshness,
  stationDetailResponseSchema,
  stationIdSchema,
  type DatasetStatus,
  type PublicStationDetail,
} from "@/domain/public-api";
import type { FuelType } from "@/domain/fuel";

export type StationDetailFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type StationDetail = Readonly<{
  extractionDate: string;
  freshness: DatasetStatus["freshness"];
  station: PublicStationDetail;
}>;

export type StationDetailState =
  | { status: "idle"; requestId: number }
  | { status: "loading"; requestId: number; stationId: string }
  | { status: "ready"; requestId: number; detail: StationDetail }
  | { status: "missing"; requestId: number; stationId: string }
  | { status: "error"; requestId: number; stationId: string; message: string };

export type StationDetailAction =
  | { type: "start"; requestId: number; stationId: string }
  | { type: "success"; requestId: number; detail: StationDetail }
  | { type: "missing"; requestId: number; stationId: string }
  | { type: "failure"; requestId: number; stationId: string; message: string }
  | { type: "close"; requestId: number };

export const INITIAL_STATION_DETAIL_STATE: StationDetailState = {
  status: "idle",
  requestId: 0,
};

export function stationDetailReducer(
  state: StationDetailState,
  action: StationDetailAction,
): StationDetailState {
  if (action.type === "start") {
    return { status: "loading", requestId: action.requestId, stationId: action.stationId };
  }
  if (action.type === "close") {
    return { status: "idle", requestId: action.requestId };
  }
  if (action.requestId !== state.requestId) return state;
  if (action.type === "success") {
    return { status: "ready", requestId: action.requestId, detail: action.detail };
  }
  if (action.type === "missing") {
    return { status: "missing", requestId: action.requestId, stationId: action.stationId };
  }
  return {
    status: "error",
    requestId: action.requestId,
    stationId: action.stationId,
    message: action.message,
  };
}

export function buildStationDetailUrl(stationId: string, baseUrl: string): URL {
  const id = stationIdSchema.parse(stationId);
  const base = new URL(baseUrl);
  return new URL(`/api/stations/${encodeURIComponent(id)}`, base.origin);
}

export function googleMapsDirectionsUrl(latitude: number, longitude: number): URL {
  const coordinates = validatedCoordinates(latitude, longitude);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("destination", coordinates);
  return url;
}

export function appleMapsDirectionsUrl(latitude: number, longitude: number): URL {
  const coordinates = validatedCoordinates(latitude, longitude);
  const url = new URL("https://maps.apple.com/");
  url.searchParams.set("daddr", coordinates);
  url.searchParams.set("dirflg", "d");
  return url;
}

function validatedCoordinates(latitude: number, longitude: number): string {
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ) {
    throw new RangeError("Invalid station coordinates.");
  }
  return `${latitude},${longitude}`;
}

export function supportsAppleMaps(userAgent: string): boolean {
  return /\b(?:iPhone|iPad|iPod|Macintosh|Mac OS X)\b/i.test(userAgent);
}

export function formatStationPrice(price: number, fuelType: FuelType): string {
  const unit = fuelType === "metano" ? "kg" : "l";
  return `${price.toLocaleString("it-IT", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €/${unit}`;
}

export async function fetchStationDetail(
  stationId: string,
  options: {
    fetcher?: StationDetailFetcher;
    signal?: AbortSignal;
    baseUrl?: string;
    now?: Date;
  } = {},
): Promise<{ status: "ok"; detail: StationDetail } | { status: "missing" }> {
  const baseUrl = options.baseUrl ?? globalThis.location?.origin;
  if (!baseUrl) throw new Error("Manca un’origine per il dettaglio.");
  const response = await (options.fetcher ?? globalThis.fetch)(
    buildStationDetailUrl(stationId, baseUrl),
    { signal: options.signal, credentials: "same-origin" },
  );
  if (response.status === 404) return { status: "missing" };
  if (!response.ok) {
    throw new Error(
      response.status === 503
        ? "Il dataset non è momentaneamente disponibile."
        : "Impossibile caricare il distributore.",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("La risposta del distributore non è valida.");
  }
  const parsed = stationDetailResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error("La risposta del distributore non è valida.");
  const { extractionDate, station } = parsed.data.data;
  return {
    status: "ok",
    detail: {
      extractionDate,
      freshness: getDatasetFreshness(extractionDate, options.now),
      station,
    },
  };
}
