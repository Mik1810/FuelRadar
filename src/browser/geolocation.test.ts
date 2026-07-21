import { describe, expect, test } from "bun:test";

import {
  createBrowserGeolocationController,
  type BrowserGeolocationEnvironment,
} from "@/browser/geolocation";
import { createBrowserPreferenceStore } from "@/browser/preferences";

const timestamp = Date.now();

function position(
  latitude = 41.9028,
  longitude = 12.4964,
  accuracy = 12,
): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp,
    toJSON: () => ({}),
  };
}

function geoError(code: number): GeolocationPositionError {
  return { code, message: "must not be exposed" } as GeolocationPositionError;
}

class FakeGeolocation {
  success: PositionCallback | null = null;
  failure: PositionErrorCallback | null = null;
  options: PositionOptions | undefined;
  watchCalls = 0;
  cleared: number[] = [];

  watchPosition = (
    success: PositionCallback,
    failure?: PositionErrorCallback | null,
    options?: PositionOptions,
  ) => {
    this.watchCalls += 1;
    this.success = success;
    this.failure = failure ?? null;
    this.options = options;
    return 7;
  };

  clearWatch = (id: number) => {
    this.cleared.push(id);
  };
}

class FakePermissionStatus {
  state: PermissionState;
  listener: (() => void) | null = null;

  constructor(state: PermissionState) {
    this.state = state;
  }

  addEventListener = (_type: "change", listener: () => void) => {
    this.listener = listener;
  };

  removeEventListener = (_type: "change", listener: () => void) => {
    if (this.listener === listener) this.listener = null;
  };

  change(state: PermissionState) {
    this.state = state;
    this.listener?.();
  }
}

function environment(
  geolocation: FakeGeolocation,
  permission?: FakePermissionStatus,
): BrowserGeolocationEnvironment {
  return {
    isSecureContext: true,
    geolocation,
    permissions: permission
      ? { query: async () => permission }
      : undefined,
  };
}

describe("browser geolocation", () => {
  test("does not request a prompt on startup when permission is not granted", async () => {
    const geolocation = new FakeGeolocation();
    const permission = new FakePermissionStatus("prompt");
    const controller = createBrowserGeolocationController(
      createBrowserPreferenceStore(),
      environment(geolocation, permission),
    );

    await controller.resumeIfGranted();
    expect(controller.getSnapshot()).toBe("idle");
    expect(geolocation.watchCalls).toBe(0);

    controller.requestFromUserGesture();
    expect(geolocation.watchCalls).toBe(1);
    expect(controller.getSnapshot()).toBe("requesting");
    expect(geolocation.options).toEqual({
      enableHighAccuracy: false,
      maximumAge: 60_000,
      timeout: 15_000,
    });
  });

  test("resumes and keeps updating when browser permission is already granted", async () => {
    const store = createBrowserPreferenceStore();
    const geolocation = new FakeGeolocation();
    const permission = new FakePermissionStatus("granted");
    const controller = createBrowserGeolocationController(
      store,
      environment(geolocation, permission),
    );

    await controller.resumeIfGranted();
    await controller.resumeIfGranted();
    expect(geolocation.watchCalls).toBe(1);

    geolocation.success?.(position());
    expect(controller.getSnapshot()).toBe("watching");
    expect(store.getSnapshot()).toMatchObject({
      locationMode: "gps",
      lastGpsPosition: {
        latitude: 41.9028,
        longitude: 12.4964,
        accuracyMeters: 12,
        capturedAt: timestamp,
      },
    });

    geolocation.success?.(position(45.46, 9.19, 25));
    expect(store.getSnapshot().lastGpsPosition).toMatchObject({
      latitude: 45.46,
      accuracyMeters: 25,
    });
  });

  test("handles denied, missing API, insecure context and Permissions failures", async () => {
    const deniedGeo = new FakeGeolocation();
    const denied = createBrowserGeolocationController(
      createBrowserPreferenceStore(),
      environment(deniedGeo, new FakePermissionStatus("denied")),
    );
    await denied.resumeIfGranted();
    expect(denied.getSnapshot()).toBe("permission-denied");
    expect(deniedGeo.watchCalls).toBe(0);

    const unsupported = createBrowserGeolocationController(
      createBrowserPreferenceStore(),
      { isSecureContext: true },
    );
    unsupported.requestFromUserGesture();
    expect(unsupported.getSnapshot()).toBe("unsupported");

    const insecureGeo = new FakeGeolocation();
    const insecure = createBrowserGeolocationController(
      createBrowserPreferenceStore(),
      { isSecureContext: false, geolocation: insecureGeo },
    );
    insecure.requestFromUserGesture();
    expect(insecure.getSnapshot()).toBe("insecure");
    expect(insecureGeo.watchCalls).toBe(0);

    const rejectedGeo = new FakeGeolocation();
    const rejected = createBrowserGeolocationController(
      createBrowserPreferenceStore(),
      {
        isSecureContext: true,
        geolocation: rejectedGeo,
        permissions: {
          query: async () => {
            throw new DOMException("unsupported", "TypeError");
          },
        },
      },
    );
    await rejected.resumeIfGranted();
    expect(rejected.getSnapshot()).toBe("idle");
    expect(rejectedGeo.watchCalls).toBe(0);
  });

  test("maps errors and preserves the last valid position", () => {
    for (const [code, state] of [
      [1, "permission-denied"],
      [2, "position-unavailable"],
      [3, "timeout"],
    ] as const) {
      const geolocation = new FakeGeolocation();
      const controller = createBrowserGeolocationController(
        createBrowserPreferenceStore(),
        environment(geolocation),
      );
      controller.requestFromUserGesture();
      geolocation.failure?.(geoError(code));
      expect(controller.getSnapshot()).toBe(state);
    }

    const store = createBrowserPreferenceStore();
    const geolocation = new FakeGeolocation();
    const controller = createBrowserGeolocationController(
      store,
      environment(geolocation),
    );
    controller.requestFromUserGesture();
    geolocation.success?.(position());
    const valid = store.getSnapshot().lastGpsPosition;
    geolocation.success?.(position(Number.NaN, 12, 10));
    expect(controller.getSnapshot()).toBe("position-unavailable");
    expect(store.getSnapshot().lastGpsPosition).toBe(valid);
  });

  test("does not regress a newer cached fix with an older callback", () => {
    const store = createBrowserPreferenceStore();
    const geolocation = new FakeGeolocation();
    const controller = createBrowserGeolocationController(
      store,
      environment(geolocation),
    );
    expect(
      store.setGpsPosition({
        latitude: 45,
        longitude: 9,
        accuracyMeters: 10,
        capturedAt: timestamp + 1_000,
      }),
    ).toBeTrue();
    controller.requestFromUserGesture();
    geolocation.success?.(position());

    expect(controller.getSnapshot()).toBe("watching");
    expect(store.getSnapshot().lastGpsPosition?.latitude).toBe(45);
  });

  test("reacts to permission changes and clears watch/listeners on dispose", async () => {
    const geolocation = new FakeGeolocation();
    const permission = new FakePermissionStatus("prompt");
    const controller = createBrowserGeolocationController(
      createBrowserPreferenceStore(),
      environment(geolocation, permission),
    );
    await controller.resumeIfGranted();
    permission.change("granted");
    expect(geolocation.watchCalls).toBe(1);

    permission.change("prompt");
    expect(geolocation.cleared).toEqual([7]);
    expect(controller.getSnapshot()).toBe("idle");

    permission.change("granted");
    expect(geolocation.watchCalls).toBe(2);

    controller.dispose();
    expect(geolocation.cleared).toEqual([7, 7]);
    expect(permission.listener).toBeNull();
  });

  test("ignores pending permission and position callbacks after stop", async () => {
    const store = createBrowserPreferenceStore();
    const geolocation = new FakeGeolocation();
    const permission = new FakePermissionStatus("granted");
    let resolvePermission!: (status: FakePermissionStatus) => void;
    const pendingPermission = new Promise<FakePermissionStatus>((resolve) => {
      resolvePermission = resolve;
    });
    const controller = createBrowserGeolocationController(store, {
      isSecureContext: true,
      geolocation,
      permissions: { query: () => pendingPermission },
    });

    const resume = controller.resumeIfGranted();
    controller.stop();
    resolvePermission(permission);
    await resume;
    expect(geolocation.watchCalls).toBe(0);

    controller.requestFromUserGesture();
    const latePosition = geolocation.success;
    controller.stop();
    latePosition?.(position());
    expect(store.getSnapshot().lastGpsPosition).toBeNull();
    expect(controller.getSnapshot()).toBe("idle");
  });

  test("a stale permission rejection cannot hide a user-started watch", async () => {
    const geolocation = new FakeGeolocation();
    let rejectPermission!: (error: Error) => void;
    const pendingPermission = new Promise<FakePermissionStatus>((_resolve, reject) => {
      rejectPermission = reject;
    });
    const controller = createBrowserGeolocationController(
      createBrowserPreferenceStore(),
      {
        isSecureContext: true,
        geolocation,
        permissions: { query: () => pendingPermission },
      },
    );

    const resume = controller.resumeIfGranted();
    controller.requestFromUserGesture();
    rejectPermission(new Error("late Permissions failure"));
    await resume;

    expect(geolocation.watchCalls).toBe(1);
    expect(controller.getSnapshot()).toBe("requesting");
  });
});
