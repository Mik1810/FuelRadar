import { isStationId } from "@/domain/station-id";

export const STATION_DIALOG_HISTORY_KEY = "fuelRadarStationDetail";

export function stationIdFromHistoryState(state: unknown): string | null {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return null;
  const value = (state as Record<string, unknown>)[STATION_DIALOG_HISTORY_KEY];
  return typeof value === "string" && isStationId(value) ? value : null;
}

export function stationDialogHistoryState(current: unknown, stationId: string): Record<string, unknown> {
  if (!isStationId(stationId)) throw new TypeError("Invalid station history identifier.");
  const base = typeof current === "object" && current !== null && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  return { ...base, [STATION_DIALOG_HISTORY_KEY]: stationId };
}
