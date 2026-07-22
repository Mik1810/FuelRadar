import { describe, expect, test } from "bun:test";

import {
  BROWSER_PREFERENCES_KEY,
  BROWSER_PREFERENCES_VERSION,
  createBrowserPreferenceStore,
  DEFAULT_BROWSER_PREFERENCES,
  GPS_CURRENT_MAX_AGE_MS,
  MAX_FAVORITES,
  gpsFreshness,
  gpsFreshnessRefreshDelay,
  parseBrowserPreferences,
  preferredSearchOrigin,
  readBrowserPreferences,
  toggleFavoriteIds,
  type BrowserPreferences,
  type PreferencesStorage,
} from "@/browser/preferences";

const now = 1_800_000_000_000;

const municipality = {
  code: "001001",
  name: "Agliè",
  province: "TO",
  region: "Piemonte",
  latitude: 45.36,
  longitude: 7.77,
};

const gpsPosition = {
  latitude: 41.9028,
  longitude: 12.4964,
  accuracyMeters: 18,
  capturedAt: now - 60_000,
};

const validPreferences: BrowserPreferences = {
  version: BROWSER_PREFERENCES_VERSION,
  fuelType: "diesel",
  serviceMode: "served",
  radiusKm: 20,
  favorites: ["station-123", "station_456.v2"],
  locationMode: "municipality",
  selectedMunicipality: municipality,
  lastGpsPosition: gpsPosition,
};

class MemoryStorage implements PreferencesStorage {
  values = new Map<string, string>();
  removed: string[] = [];

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.removed.push(key);
    this.values.delete(key);
  }
}

describe("browser preferences", () => {
  test("uses safe defaults for empty, corrupt and unavailable storage", () => {
    const empty = new MemoryStorage();
    expect(readBrowserPreferences(empty, now)).toBe(DEFAULT_BROWSER_PREFERENCES);

    const malformed = new MemoryStorage();
    malformed.values.set(BROWSER_PREFERENCES_KEY, "{not-json");
    expect(readBrowserPreferences(malformed, now)).toBe(
      DEFAULT_BROWSER_PREFERENCES,
    );
    expect(malformed.removed).toEqual([BROWSER_PREFERENCES_KEY]);

    const unavailable: PreferencesStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    expect(readBrowserPreferences(unavailable, now)).toBe(
      DEFAULT_BROWSER_PREFERENCES,
    );
  });

  test("round-trips every persisted preference across a refresh", () => {
    const storage = new MemoryStorage();
    const firstVisit = createBrowserPreferenceStore();
    firstVisit.hydrate(storage, now);
    expect(firstVisit.update(validPreferences, now)).toBeTrue();

    const nextVisit = createBrowserPreferenceStore();
    nextVisit.hydrate(storage, now);
    expect(nextVisit.getSnapshot()).toEqual(validPreferences);
  });

  test("rejects unsupported versions, invalid values and inconsistent modes", () => {
    for (const invalid of [
      { ...validPreferences, version: 2 },
      { ...validPreferences, radiusKm: 51 },
      { ...validPreferences, favorites: ["123", "123"] },
      {
        ...validPreferences,
        selectedMunicipality: { ...municipality, latitude: 200 },
      },
      { ...validPreferences, locationMode: "gps", lastGpsPosition: null },
      { ...validPreferences, debug: true },
    ]) {
      expect(parseBrowserPreferences(invalid, now)).toBeNull();
    }
  });

  test("switches the active location explicitly and keeps both cached choices", () => {
    const store = createBrowserPreferenceStore();
    expect(store.selectMunicipality(municipality, now)).toBeTrue();
    expect(store.getSnapshot().locationMode).toBe("municipality");
    expect(preferredSearchOrigin(store.getSnapshot(), now)).toMatchObject({
      source: "municipality",
      latitude: municipality.latitude,
    });

    expect(store.setGpsPosition(gpsPosition, now)).toBeTrue();
    expect(store.getSnapshot().selectedMunicipality).toEqual(municipality);
    expect(preferredSearchOrigin(store.getSnapshot(), now)).toMatchObject({
      source: "gps",
      freshness: "current",
    });
  });

  test("marks old GPS data stale without discarding the usable fallback", () => {
    expect(gpsFreshness(gpsPosition, gpsPosition.capturedAt)).toEqual({
      status: "current",
      ageMs: 0,
    });
    expect(
      gpsFreshness(
        gpsPosition,
        gpsPosition.capturedAt + GPS_CURRENT_MAX_AGE_MS + 1,
      ),
    ).toEqual({
      status: "stale",
      ageMs: GPS_CURRENT_MAX_AGE_MS + 1,
    });
    expect(
      gpsFreshnessRefreshDelay(
        gpsPosition,
        gpsPosition.capturedAt + GPS_CURRENT_MAX_AGE_MS,
      ),
    ).toBe(1);
    expect(
      gpsFreshnessRefreshDelay(
        gpsPosition,
        gpsPosition.capturedAt + GPS_CURRENT_MAX_AGE_MS + 1,
      ),
    ).toBeNull();

    const stalePreferences = {
      ...validPreferences,
      locationMode: "gps" as const,
    };
    expect(
      preferredSearchOrigin(
        stalePreferences,
        gpsPosition.capturedAt + GPS_CURRENT_MAX_AGE_MS + 1,
      ),
    ).toMatchObject({ source: "gps", freshness: "stale" });
  });

  test("notifies subscribers, keeps snapshots stable and resets storage", () => {
    const storage = new MemoryStorage();
    const store = createBrowserPreferenceStore();
    store.hydrate(storage, now);
    const initial = store.getSnapshot();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    expect(store.getSnapshot()).toBe(initial);
    expect(store.update({ radiusKm: 5 }, now)).toBeTrue();
    expect(store.getSnapshot()).not.toBe(initial);
    expect(notifications).toBe(1);
    expect(storage.getItem(BROWSER_PREFERENCES_KEY)).toContain('"radiusKm":5');

    store.reset();
    expect(store.getSnapshot()).toBe(DEFAULT_BROWSER_PREFERENCES);
    expect(storage.getItem(BROWSER_PREFERENCES_KEY)).toBeNull();
    unsubscribe();
  });

  test("keeps valid in-memory updates when persistent writes are blocked", () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    const store = createBrowserPreferenceStore();
    store.hydrate(storage, now);

    expect(store.update({ fuelType: "gpl", favorites: ["999"] }, now)).toBeTrue();
    expect(store.getSnapshot()).toMatchObject({
      fuelType: "gpl",
      favorites: ["999"],
    });
  });

  test("toggles canonical favorites without duplicates, mutation or overflow", () => {
    const original = ["123", "456"] as const;
    expect(toggleFavoriteIds(original, "123")).toEqual(["456"]);
    expect(toggleFavoriteIds(original, "789")).toEqual(["123", "456", "789"]);
    expect(original).toEqual(["123", "456"]);
    expect(toggleFavoriteIds(original, "bad/id")).toBe(original);
    const full = Array.from({ length: MAX_FAVORITES }, (_, index) => String(index));
    expect(toggleFavoriteIds(full, "new-station")).toBe(full);
  });

  test("persists favorite toggles across a fresh store hydration", () => {
    const storage = new MemoryStorage();
    const first = createBrowserPreferenceStore();
    first.hydrate(storage, now);
    expect(first.update((current) => ({ ...current, favorites: toggleFavoriteIds(current.favorites, "123") }), now)).toBeTrue();

    const refreshed = createBrowserPreferenceStore();
    refreshed.hydrate(storage, now);
    expect(refreshed.getSnapshot().favorites).toEqual(["123"]);
  });
});
