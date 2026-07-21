import type {
  BrowserPreferenceStore,
  StoredGpsPosition,
} from "@/browser/preferences";

export type GeolocationState =
  | "idle"
  | "checking-permission"
  | "requesting"
  | "watching"
  | "permission-denied"
  | "position-unavailable"
  | "timeout"
  | "insecure"
  | "unsupported";

type GeolocationLike = Pick<
  Geolocation,
  "watchPosition" | "clearWatch"
>;

type PermissionStatusLike = {
  state: PermissionState;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

type PermissionsLike = {
  query(descriptor: { name: "geolocation" }): Promise<PermissionStatusLike>;
};

export type BrowserGeolocationEnvironment = {
  geolocation?: GeolocationLike;
  permissions?: PermissionsLike;
  isSecureContext?: boolean;
};

type Listener = () => void;

function validPosition(position: GeolocationPosition): StoredGpsPosition | null {
  const { latitude, longitude, accuracy } = position.coords;
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > 1_000_000 ||
    !Number.isSafeInteger(position.timestamp) ||
    position.timestamp <= 0
  ) {
    return null;
  }
  return {
    latitude,
    longitude,
    accuracyMeters: accuracy,
    capturedAt: position.timestamp,
  };
}

export class BrowserGeolocationController {
  private state: GeolocationState = "idle";
  private watchId: number | null = null;
  private watchGeneration = 0;
  private permissionRequest = 0;
  private permissionStatus: PermissionStatusLike | null = null;
  private listeners = new Set<Listener>();

  constructor(
    private readonly preferences: BrowserPreferenceStore,
    private readonly environment: BrowserGeolocationEnvironment,
  ) {}

  getSnapshot = (): GeolocationState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async resumeIfGranted(): Promise<void> {
    if (this.environment.isSecureContext === false) {
      this.setState("insecure");
      return;
    }
    if (!this.environment.geolocation) {
      this.setState("unsupported");
      return;
    }
    if (!this.environment.permissions) return;
    const request = ++this.permissionRequest;
    this.setState("checking-permission");
    try {
      const permission = await this.environment.permissions.query({
        name: "geolocation",
      });
      if (request !== this.permissionRequest) return;
      this.watchPermission(permission);
      if (permission.state === "granted") {
        this.startWatch();
      } else {
        this.setState(
          permission.state === "denied" ? "permission-denied" : "idle",
        );
      }
    } catch {
      // Safari versions without a usable Permissions API must wait for a tap.
      if (request === this.permissionRequest) this.setState("idle");
    }
  }

  requestFromUserGesture(): void {
    if (this.environment.isSecureContext === false) {
      this.setState("insecure");
      return;
    }
    if (!this.environment.geolocation) {
      this.setState("unsupported");
      return;
    }
    this.permissionRequest += 1;
    this.startWatch();
  }

  stop(): void {
    this.permissionRequest += 1;
    this.watchGeneration += 1;
    if (this.watchId !== null && this.environment.geolocation) {
      this.environment.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.setState("idle");
  }

  dispose(): void {
    if (this.permissionStatus?.removeEventListener) {
      this.permissionStatus.removeEventListener("change", this.onPermissionChange);
    }
    this.permissionStatus = null;
    this.stop();
  }

  private startWatch(): void {
    if (this.watchId !== null || !this.environment.geolocation) return;
    const generation = ++this.watchGeneration;
    this.setState("requesting");
    try {
      this.watchId = this.environment.geolocation.watchPosition(
        (position) => {
          if (generation !== this.watchGeneration) return;
          const stored = validPosition(position);
          const previous = this.preferences.getSnapshot().lastGpsPosition;
          if (!stored) {
            this.setState("position-unavailable");
            return;
          }
          if (previous && stored.capturedAt < previous.capturedAt) {
            this.setState("watching");
            return;
          }
          if (!this.preferences.setGpsPosition(stored)) {
            this.setState("position-unavailable");
            return;
          }
          this.setState("watching");
        },
        (error) => {
          if (generation === this.watchGeneration) this.onPositionError(error);
        },
        {
          enableHighAccuracy: false,
          maximumAge: 60_000,
          timeout: 15_000,
        },
      );
      if (this.state === "permission-denied" && this.watchId !== null) {
        this.watchGeneration += 1;
        this.environment.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
    } catch {
      this.setState("position-unavailable");
    }
  }

  private onPositionError(error: GeolocationPositionError): void {
    if (error.code === 1) {
      this.watchGeneration += 1;
      if (this.watchId !== null && this.environment.geolocation) {
        this.environment.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
      this.setState("permission-denied");
    } else if (error.code === 3) {
      this.setState("timeout");
    } else {
      this.setState("position-unavailable");
    }
  }

  private watchPermission(permission: PermissionStatusLike): void {
    if (this.permissionStatus?.removeEventListener) {
      this.permissionStatus.removeEventListener("change", this.onPermissionChange);
    }
    this.permissionStatus = permission;
    permission.addEventListener?.("change", this.onPermissionChange);
  }

  private onPermissionChange = (): void => {
    if (this.permissionStatus?.state === "granted") {
      this.startWatch();
    } else if (this.permissionStatus?.state === "denied") {
      this.stop();
      this.setState("permission-denied");
    } else {
      this.stop();
    }
  };

  private setState(state: GeolocationState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

export function createBrowserGeolocationController(
  preferences: BrowserPreferenceStore,
  environment: BrowserGeolocationEnvironment,
): BrowserGeolocationController {
  return new BrowserGeolocationController(preferences, environment);
}
