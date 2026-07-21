import { afterEach, describe, expect, test } from "bun:test";

import {
  browserPreferenceStore,
  hydrateBrowserPreferences,
  selectBrowserMunicipality,
} from "@/browser/browser-state";

afterEach(() => browserPreferenceStore.reset());

describe("browser state integration", () => {
  test("is safe without window and when the localStorage getter throws", () => {
    expect(hydrateBrowserPreferences(undefined)).toBeFalse();
    const restricted = Object.defineProperty({}, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    }) as { readonly localStorage: Storage };

    expect(hydrateBrowserPreferences(restricted)).toBeFalse();
    expect(browserPreferenceStore.getSnapshot().locationMode).toBeNull();
  });

  test("does not stop or replace GPS for an invalid municipality suggestion", () => {
    const capturedAt = Date.now();
    expect(
      browserPreferenceStore.setGpsPosition({
        latitude: 41.9,
        longitude: 12.5,
        accuracyMeters: 10,
        capturedAt,
      }),
    ).toBeTrue();

    expect(
      selectBrowserMunicipality({
        kind: "municipality",
        id: "municipality:invalid",
        name: "Invalid",
        province: "RM",
        region: "Lazio",
        point: { latitude: 41.9, longitude: 12.5 },
      }),
    ).toBeFalse();
    expect(browserPreferenceStore.getSnapshot()).toMatchObject({
      locationMode: "gps",
      lastGpsPosition: { capturedAt },
    });
  });
});
