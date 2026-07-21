import type { FuelType, ServiceMode } from "@/domain/fuel";
import { FUEL_TYPES, SERVICE_MODES } from "@/domain/fuel";
import { isStationId } from "@/domain/station-id";

export const BROWSER_PREFERENCES_VERSION = 1;
export const BROWSER_PREFERENCES_KEY = "fuelradar:preferences";
export const GPS_CURRENT_MAX_AGE_MS = 15 * 60 * 1_000;

const MAX_FAVORITES = 500;
const MAX_SERIALIZED_PREFERENCES_LENGTH = 128 * 1_024;
const MUNICIPALITY_CODE = /^\d{6}$/;

export type StoredMunicipality = {
  code: string;
  name: string;
  province: string;
  region: string;
  latitude: number;
  longitude: number;
};

export type StoredGpsPosition = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: number;
};

export type BrowserPreferences = {
  version: typeof BROWSER_PREFERENCES_VERSION;
  fuelType: FuelType;
  serviceMode: ServiceMode;
  radiusKm: number;
  favorites: readonly string[];
  locationMode: "gps" | "municipality" | null;
  selectedMunicipality: StoredMunicipality | null;
  lastGpsPosition: StoredGpsPosition | null;
};

export const DEFAULT_BROWSER_PREFERENCES: BrowserPreferences = Object.freeze({
  version: BROWSER_PREFERENCES_VERSION,
  fuelType: "benzina",
  serviceMode: "self",
  radiusKm: 10,
  favorites: Object.freeze([]),
  locationMode: null,
  selectedMunicipality: null,
  lastGpsPosition: null,
});

export type PreferencesStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validCoordinates(latitude: unknown, longitude: unknown): boolean {
  return (
    isFiniteNumber(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    isFiniteNumber(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function parseMunicipality(value: unknown): StoredMunicipality | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !boundedText(value.code, 6) ||
    !MUNICIPALITY_CODE.test(value.code) ||
    !boundedText(value.name, 160) ||
    !boundedText(value.province, 4) ||
    !boundedText(value.region, 80) ||
    !validCoordinates(value.latitude, value.longitude)
  ) {
    return undefined;
  }
  return {
    code: value.code,
    name: value.name,
    province: value.province,
    region: value.region,
    latitude: value.latitude as number,
    longitude: value.longitude as number,
  };
}

function parseGpsPosition(
  value: unknown,
  now: number,
): StoredGpsPosition | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !validCoordinates(value.latitude, value.longitude) ||
    !isFiniteNumber(value.accuracyMeters) ||
    value.accuracyMeters < 0 ||
    value.accuracyMeters > 1_000_000 ||
    !Number.isSafeInteger(value.capturedAt) ||
    (value.capturedAt as number) <= 0 ||
    (value.capturedAt as number) > now + 5 * 60 * 1_000
  ) {
    return undefined;
  }
  return {
    latitude: value.latitude as number,
    longitude: value.longitude as number,
    accuracyMeters: value.accuracyMeters,
    capturedAt: value.capturedAt as number,
  };
}

export function parseBrowserPreferences(
  value: unknown,
  now = Date.now(),
): BrowserPreferences | null {
  if (!isRecord(value) || value.version !== BROWSER_PREFERENCES_VERSION) {
    return null;
  }
  const allowedKeys = new Set([
    "version",
    "fuelType",
    "serviceMode",
    "radiusKm",
    "favorites",
    "locationMode",
    "selectedMunicipality",
    "lastGpsPosition",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  if (!FUEL_TYPES.includes(value.fuelType as FuelType)) return null;
  if (!SERVICE_MODES.includes(value.serviceMode as ServiceMode)) return null;
  if (
    !isFiniteNumber(value.radiusKm) ||
    value.radiusKm < 0.1 ||
    value.radiusKm > 50
  ) {
    return null;
  }
  if (
    !Array.isArray(value.favorites) ||
    value.favorites.length > MAX_FAVORITES ||
    !value.favorites.every(
      (stationId) => isStationId(stationId),
    ) ||
    new Set(value.favorites).size !== value.favorites.length
  ) {
    return null;
  }
  const selectedMunicipality = parseMunicipality(value.selectedMunicipality);
  const lastGpsPosition = parseGpsPosition(value.lastGpsPosition, now);
  if (selectedMunicipality === undefined || lastGpsPosition === undefined) {
    return null;
  }
  if (
    (value.locationMode !== null &&
      value.locationMode !== "gps" &&
      value.locationMode !== "municipality") ||
    (value.locationMode === "gps" && lastGpsPosition === null) ||
    (value.locationMode === "municipality" && selectedMunicipality === null)
  ) {
    return null;
  }
  return {
    version: BROWSER_PREFERENCES_VERSION,
    fuelType: value.fuelType as FuelType,
    serviceMode: value.serviceMode as ServiceMode,
    radiusKm: value.radiusKm,
    favorites: [...value.favorites],
    locationMode: value.locationMode,
    selectedMunicipality,
    lastGpsPosition,
  };
}

export function readBrowserPreferences(
  storage: PreferencesStorage,
  now = Date.now(),
): BrowserPreferences {
  try {
    const serialized = storage.getItem(BROWSER_PREFERENCES_KEY);
    if (serialized === null) return DEFAULT_BROWSER_PREFERENCES;
    if (serialized.length > MAX_SERIALIZED_PREFERENCES_LENGTH) {
      storage.removeItem(BROWSER_PREFERENCES_KEY);
      return DEFAULT_BROWSER_PREFERENCES;
    }
    const parsed = parseBrowserPreferences(JSON.parse(serialized), now);
    if (parsed) return parsed;
    storage.removeItem(BROWSER_PREFERENCES_KEY);
  } catch {
    try {
      storage.removeItem(BROWSER_PREFERENCES_KEY);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }
  return DEFAULT_BROWSER_PREFERENCES;
}

export function writeBrowserPreferences(
  storage: PreferencesStorage,
  preferences: BrowserPreferences,
): boolean {
  try {
    const serialized = JSON.stringify(preferences);
    if (serialized.length > MAX_SERIALIZED_PREFERENCES_LENGTH) return false;
    storage.setItem(BROWSER_PREFERENCES_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

export type GpsFreshness =
  | { status: "missing"; ageMs: null }
  | { status: "current" | "stale"; ageMs: number };

export function gpsFreshness(
  position: StoredGpsPosition | null,
  now = Date.now(),
): GpsFreshness {
  if (!position) return { status: "missing", ageMs: null };
  const ageMs = Math.max(0, now - position.capturedAt);
  return {
    status: ageMs <= GPS_CURRENT_MAX_AGE_MS ? "current" : "stale",
    ageMs,
  };
}

export function gpsFreshnessRefreshDelay(
  position: StoredGpsPosition | null,
  now = Date.now(),
): number | null {
  if (!position) return null;
  const staleAt = position.capturedAt + GPS_CURRENT_MAX_AGE_MS;
  return now <= staleAt ? staleAt - now + 1 : null;
}

export type PreferredSearchOrigin =
  | {
      source: "gps";
      latitude: number;
      longitude: number;
      accuracyMeters: number;
      capturedAt: number;
      freshness: "current" | "stale";
    }
  | {
      source: "municipality";
      latitude: number;
      longitude: number;
      municipality: StoredMunicipality;
    }
  | null;

export function preferredSearchOrigin(
  preferences: BrowserPreferences,
  now = Date.now(),
): PreferredSearchOrigin {
  if (preferences.locationMode === "gps" && preferences.lastGpsPosition) {
    const position = preferences.lastGpsPosition;
    const freshness = gpsFreshness(position, now);
    return {
      source: "gps",
      latitude: position.latitude,
      longitude: position.longitude,
      accuracyMeters: position.accuracyMeters,
      capturedAt: position.capturedAt,
      freshness: freshness.status === "current" ? "current" : "stale",
    };
  }
  if (
    preferences.locationMode === "municipality" &&
    preferences.selectedMunicipality
  ) {
    return {
      source: "municipality",
      latitude: preferences.selectedMunicipality.latitude,
      longitude: preferences.selectedMunicipality.longitude,
      municipality: preferences.selectedMunicipality,
    };
  }
  return null;
}

type Listener = () => void;

export class BrowserPreferenceStore {
  private preferences: BrowserPreferences = DEFAULT_BROWSER_PREFERENCES;
  private storage: PreferencesStorage | null = null;
  private listeners = new Set<Listener>();

  getSnapshot = (): BrowserPreferences => this.preferences;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  hydrate(storage: PreferencesStorage, now = Date.now()): void {
    this.storage = storage;
    this.replace(readBrowserPreferences(storage, now), false);
  }

  update(
    updater:
      | Partial<Omit<BrowserPreferences, "version">>
      | ((current: BrowserPreferences) => BrowserPreferences),
    now = Date.now(),
  ): boolean {
    const candidate =
      typeof updater === "function"
        ? updater(this.preferences)
        : { ...this.preferences, ...updater };
    const parsed = parseBrowserPreferences(candidate, now);
    if (!parsed) return false;
    this.replace(parsed, true);
    return true;
  }

  selectMunicipality(municipality: StoredMunicipality, now = Date.now()): boolean {
    return this.update(
      { selectedMunicipality: municipality, locationMode: "municipality" },
      now,
    );
  }

  setGpsPosition(position: StoredGpsPosition, now = Date.now()): boolean {
    return this.update(
      { lastGpsPosition: position, locationMode: "gps" },
      now,
    );
  }

  reset(): void {
    if (this.storage) {
      try {
        this.storage.removeItem(BROWSER_PREFERENCES_KEY);
      } catch {
        // In-memory state still returns to safe defaults.
      }
    }
    this.replace(DEFAULT_BROWSER_PREFERENCES, false);
  }

  private replace(preferences: BrowserPreferences, persist: boolean): void {
    this.preferences = preferences;
    if (persist && this.storage) {
      writeBrowserPreferences(this.storage, preferences);
    }
    for (const listener of this.listeners) listener();
  }
}

export function createBrowserPreferenceStore(): BrowserPreferenceStore {
  return new BrowserPreferenceStore();
}
