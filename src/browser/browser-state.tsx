"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  createBrowserGeolocationController,
  type BrowserGeolocationEnvironment,
} from "@/browser/geolocation";
import {
  createBrowserPreferenceStore,
  DEFAULT_BROWSER_PREFERENCES,
  gpsFreshness,
  gpsFreshnessRefreshDelay,
} from "@/browser/preferences";
import type { MunicipalitySuggestion } from "@/domain/geocoding";

export const browserPreferenceStore = createBrowserPreferenceStore();

function browserEnvironment(): BrowserGeolocationEnvironment {
  if (typeof navigator === "undefined") return {};
  return {
    geolocation: navigator.geolocation,
    permissions: navigator.permissions,
    isSecureContext: globalThis.isSecureContext,
  };
}

let geolocationController: ReturnType<
  typeof createBrowserGeolocationController
> | null = null;

function controller() {
  geolocationController ??= createBrowserGeolocationController(
    browserPreferenceStore,
    browserEnvironment(),
  );
  return geolocationController;
}

export function BrowserStateBootstrap() {
  useEffect(() => {
    hydrateBrowserPreferences(window);
    const geolocation = controller();
    if (browserPreferenceStore.getSnapshot().locationMode === "gps") {
      void geolocation.resumeIfGranted();
    }
    return () => geolocation.dispose();
  }, []);
  return null;
}

export function hydrateBrowserPreferences(
  browser: { readonly localStorage: Storage } | undefined,
): boolean {
  if (!browser) return false;
  try {
    browserPreferenceStore.hydrate(browser.localStorage);
    return true;
  } catch {
    // Some sandboxed/private contexts throw while accessing the getter itself.
    return false;
  }
}

export function useBrowserPreferences() {
  return useSyncExternalStore(
    browserPreferenceStore.subscribe,
    browserPreferenceStore.getSnapshot,
    () => DEFAULT_BROWSER_PREFERENCES,
  );
}

export function useBrowserGeolocationState() {
  const geolocation = controller();
  return useSyncExternalStore(
    geolocation.subscribe,
    geolocation.getSnapshot,
    () => "idle" as const,
  );
}

export function useGpsFreshness() {
  const preferences = useBrowserPreferences();
  const position = preferences.lastGpsPosition;
  const [observedAt, setObservedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!position) return;
    const now = Date.now();
    const delay = gpsFreshnessRefreshDelay(position, now) ?? 0;
    const timer = window.setTimeout(() => setObservedAt(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [position]);

  return gpsFreshness(position, observedAt);
}

export function requestBrowserGeolocation(): void {
  controller().requestFromUserGesture();
}

export function selectBrowserMunicipality(
  municipality: MunicipalitySuggestion,
): boolean {
  const selected = browserPreferenceStore.selectMunicipality({
    code: municipality.id.slice("municipality:".length),
    name: municipality.name,
    province: municipality.province,
    region: municipality.region,
    latitude: municipality.point.latitude,
    longitude: municipality.point.longitude,
  });
  if (selected) controller().dispose();
  return selected;
}
