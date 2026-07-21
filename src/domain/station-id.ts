export const MAX_STATION_ID_LENGTH = 100;
export const STATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isStationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_STATION_ID_LENGTH &&
    STATION_ID_PATTERN.test(value)
  );
}
