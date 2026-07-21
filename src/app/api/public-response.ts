import { NextResponse } from "next/server";

export const PUBLIC_API_CACHE_CONTROL =
  "public, s-maxage=300, stale-while-revalidate=60";
export const NEARBY_CACHE_CONTROL = "private, max-age=60, must-revalidate";
export const NO_STORE_CACHE_CONTROL = "private, no-store";

export type PublicApiErrorCode =
  | "dataset_unavailable"
  | "internal_error"
  | "invalid_input"
  | "station_not_found";

export function jsonResponse<T>(
  body: T,
  status = 200,
  cacheControl = PUBLIC_API_CACHE_CONTROL,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": cacheControl,
    },
  });
}

export function errorResponse(
  code: PublicApiErrorCode,
  message: string,
  status: number,
) {
  return jsonResponse({ error: { code, message } }, status, NO_STORE_CACHE_CONTROL);
}

export function logPublicApiFailure(endpoint: string): void {
  console.error(JSON.stringify({ event: "public_api_failed", endpoint }));
}
