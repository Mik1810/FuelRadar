"use client";

import Image from "next/image";
import { useEffect, useRef, useSyncExternalStore } from "react";

import {
  requestBrowserGeolocation,
  useBrowserGeolocationState,
  useBrowserPreferences,
  useGpsFreshness,
} from "@/browser/browser-state";
import type { GeolocationState } from "@/browser/geolocation";
import { preferredSearchOrigin } from "@/browser/preferences";
import { SITE_NAME, SITE_TAGLINE } from "@/config/site";

export type ShellViewState =
  | "initial"
  | "loading"
  | "ready"
  | "error"
  | "offline"
  | "empty";

const STATE_CONTENT: Record<
  ShellViewState,
  { title: string; message: string }
> = {
  initial: {
    title: "Da dove vuoi cercare?",
    message:
      "Usa la posizione del dispositivo oppure scegli un comune senza condividere il GPS.",
  },
  loading: {
    title: "Cerco la tua posizione…",
    message: "Puoi continuare a usare la pagina mentre attendiamo il dispositivo.",
  },
  ready: {
    title: "Posizione pronta",
    message: "La mappa e i distributori vicini appariranno in questo pannello.",
  },
  error: {
    title: "Posizione non disponibile",
    message: "Puoi riprovare oppure proseguire scegliendo un comune.",
  },
  offline: {
    title: "Sei offline",
    message: "Riconnettiti per caricare mappa, prezzi e distributori aggiornati.",
  },
  empty: {
    title: "Nessun distributore trovato",
    message: "Prova ad aumentare il raggio o a scegliere un’altra zona.",
  },
};

export function resolveShellViewState({
  online,
  geolocation,
  hasOrigin,
}: {
  online: boolean;
  geolocation: GeolocationState;
  hasOrigin: boolean;
}): ShellViewState {
  if (!online) return "offline";
  if (hasOrigin) return "ready";
  if (
    geolocation === "checking-permission" ||
    geolocation === "requesting"
  ) {
    return "loading";
  }
  if (
    geolocation === "permission-denied" ||
    geolocation === "position-unavailable" ||
    geolocation === "timeout" ||
    geolocation === "insecure" ||
    geolocation === "unsupported"
  ) {
    return "error";
  }
  return "initial";
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function browserOnline(): boolean {
  return navigator.onLine;
}

function serverOnline(): boolean {
  return true;
}

export function ShellStatePanel({
  state,
  message,
}: {
  state: ShellViewState;
  message?: string;
}) {
  const current = STATE_CONTENT[state];
  const isLoading = state === "loading";
  const isError = state === "error" || state === "offline";

  return (
    <div
      className={`shell-feedback shell-feedback--${state}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-busy={isLoading}
    >
      <span className="shell-feedback__icon" aria-hidden="true">
        {isLoading ? "" : state === "ready" ? "✓" : "i"}
      </span>
      <div>
        <h2 id="results-title">{current.title}</h2>
        <p>{message ?? current.message}</p>
      </div>
    </div>
  );
}

export function FuelRadarShell() {
  const resultsRef = useRef<HTMLElement>(null);
  const userLocationRequest = useRef(false);
  const preferences = useBrowserPreferences();
  const geolocation = useBrowserGeolocationState();
  const freshness = useGpsFreshness();
  const online = useSyncExternalStore(
    subscribeOnline,
    browserOnline,
    serverOnline,
  );
  const origin = preferredSearchOrigin(preferences);
  const viewState = resolveShellViewState({
    online,
    geolocation,
    hasOrigin: origin !== null,
  });
  const isLocating = viewState === "loading";
  const gpsUnavailable =
    geolocation === "insecure" || geolocation === "unsupported";
  const showLocationAction =
    viewState === "initial" || viewState === "loading" || viewState === "error";
  const errorMessage =
    viewState === "error" && geolocation === "insecure"
      ? "Il GPS richiede una connessione sicura. Puoi proseguire scegliendo un comune."
      : viewState === "error" && geolocation === "unsupported"
        ? "Questo dispositivo non supporta il GPS. Puoi proseguire scegliendo un comune."
        : undefined;

  useEffect(() => {
    if (viewState !== "ready" || !userLocationRequest.current) return;
    userLocationRequest.current = false;
    resultsRef.current?.focus();
  }, [viewState]);

  function requestLocation(): void {
    userLocationRequest.current = true;
    requestBrowserGeolocation();
  }

  return (
    <div className="app-shell" id="top">
      <a className="skip-link" href="#workspace">
        Vai al contenuto
      </a>
      <header className="app-header">
        <a className="brand" href="#top" aria-label={`${SITE_NAME}, inizio pagina`}>
          <Image src="/logo.png" alt="" width={48} height={48} priority />
          <span>{SITE_NAME}</span>
        </a>
        <nav aria-label="Navigazione principale">
          <a href="#map">Mappa</a>
          <a href="#results">Risultati</a>
        </nav>
      </header>

      <main className="app-workspace" id="workspace">
        <section className="map-stage" id="map" tabIndex={-1} aria-labelledby="map-title">
          <h1 className="visually-hidden" id="map-title">
            {SITE_TAGLINE}
          </h1>
          <div
            className="map-placeholder"
            role="img"
            aria-label="Area della mappa dei distributori, in preparazione"
          >
            <span className="map-placeholder__radar" aria-hidden="true" />
            <p>Mappa distributori</p>
            <span>Qui compariranno prezzi e stazioni nella zona scelta.</span>
          </div>

          <section
            ref={resultsRef}
            className="results-sheet"
            id="results"
            tabIndex={-1}
            aria-labelledby="results-title"
          >
            <p className="eyebrow">{SITE_TAGLINE}</p>
            <ShellStatePanel state={viewState} message={errorMessage} />

            {showLocationAction ? (
              <div className="location-actions">
                <button
                  className="primary-action"
                  type="button"
                  aria-busy={isLocating}
                  aria-disabled={isLocating || gpsUnavailable}
                  onClick={
                    isLocating || gpsUnavailable
                      ? undefined
                      : requestLocation
                  }
                >
                  <span aria-hidden="true">◎</span>
                  {isLocating
                    ? "Ricerca posizione in corso…"
                    : gpsUnavailable
                      ? "GPS non disponibile su questo dispositivo"
                      : "Trova carburante vicino a te"}
                </button>
                <p>
                  Preferisci non usare il GPS? Nel selettore zona potrai cercare
                  un comune e vedere sempre provincia e regione.
                </p>
              </div>
            ) : null}

            {origin?.source === "gps" ? (
              <p className="location-summary">
                {freshness.status === "stale"
                  ? "Ultima posizione nota"
                  : geolocation === "watching"
                    ? "Posizione GPS aggiornata"
                    : "Posizione GPS salvata"}
                {freshness.ageMs !== null
                  ? ` · accuratezza ±${Math.round(origin.accuracyMeters)} m`
                  : ""}
              </p>
            ) : null}
          </section>
        </section>
      </main>
    </div>
  );
}
