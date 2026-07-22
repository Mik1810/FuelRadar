"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  browserPreferenceStore,
  requestBrowserGeolocation,
  selectBrowserMunicipality,
  useBrowserGeolocationState,
  useBrowserPreferences,
  useGpsFreshness,
} from "@/browser/browser-state";
import { createMunicipalityProvider } from "@/browser/municipality-provider";
import type { GeolocationState } from "@/browser/geolocation";
import {
  MAX_FAVORITES,
  preferredSearchOrigin,
  toggleFavoriteIds,
} from "@/browser/preferences";
import { SITE_NAME, SITE_TAGLINE } from "@/config/site";
import type { FuelType, ServiceMode } from "@/domain/fuel";
import type { MunicipalitySuggestion } from "@/domain/geocoding";
import { OPENSTREETMAP_TILE_PROVIDER } from "@/map/config";
import { formatFuelPrice } from "@/map/price-marker";
import {
  fetchStationSearch,
  INITIAL_STATION_SEARCH_STATE,
  normalizeSearchRadiusKm,
  SEARCH_RADIUS_MAX_KM,
  SEARCH_RADIUS_MIN_KM,
  stationResultMarkers,
  stationSearchReducer,
  viewportCenterChanged,
  type SearchOrigin,
  type StationSearchState,
} from "@/search/station-search";
import { nextComboboxIndex } from "@/search/combobox";
import { StationDetailPanel } from "@/station-detail/station-detail-panel";

const DynamicFuelMap = dynamic(
  () => import("@/map/map").then((module) => module.FuelMap),
  {
    ssr: false,
    loading: () => (
      <div className="map-loading" role="status" aria-live="polite">
        Caricamento della mappa…
      </div>
    ),
  },
);

const FUEL_LABELS: Record<FuelType, string> = {
  benzina: "Benzina",
  diesel: "Diesel",
  gpl: "GPL",
  metano: "Metano",
};

const SERVICE_LABELS: Record<ServiceMode, string> = {
  self: "Self service",
  served: "Servito",
};

export type ShellViewState =
  | "initial"
  | "loading"
  | "ready"
  | "error"
  | "offline"
  | "empty";

const STATE_CONTENT: Record<ShellViewState, { title: string; message: string }> = {
  initial: { title: "Da dove vuoi cercare?", message: "Usa la posizione del dispositivo oppure scegli un comune senza condividere il GPS." },
  loading: { title: "Cerco la tua posizione…", message: "Puoi continuare a usare la pagina mentre attendiamo il dispositivo." },
  ready: { title: "Posizione pronta", message: "Imposta il carburante, il servizio e il raggio per confrontare i prezzi." },
  error: { title: "Posizione non disponibile", message: "Puoi riprovare oppure proseguire scegliendo un comune." },
  offline: { title: "Sei offline", message: "Riconnettiti per caricare mappa, prezzi e distributori aggiornati." },
  empty: { title: "Nessun distributore trovato", message: "Prova ad aumentare il raggio o a scegliere un’altra zona." },
};

export function resolveShellViewState({ online, geolocation, hasOrigin }: { online: boolean; geolocation: GeolocationState; hasOrigin: boolean }): ShellViewState {
  if (!online) return "offline";
  if (hasOrigin) return "ready";
  if (geolocation === "checking-permission" || geolocation === "requesting") return "loading";
  if (["permission-denied", "position-unavailable", "timeout", "insecure", "unsupported"].includes(geolocation)) return "error";
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

function browserOnline(): boolean { return navigator.onLine; }
function serverOnline(): boolean { return true; }

export function ShellStatePanel({ state, message }: { state: ShellViewState; message?: string }) {
  const current = STATE_CONTENT[state];
  const isLoading = state === "loading";
  const isError = state === "error" || state === "offline";
  return (
    <div className={`shell-feedback shell-feedback--${state}`} role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"} aria-busy={isLoading}>
      <span className="shell-feedback__icon" aria-hidden="true">{isLoading ? "" : state === "ready" ? "✓" : "i"}</span>
      <div><h2 id="results-title">{current.title}</h2><p>{message ?? current.message}</p></div>
    </div>
  );
}

function formatDistance(distanceKm: number): string {
  return distanceKm < 1 ? `${Math.round(distanceKm * 1_000)} m` : `${distanceKm.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km`;
}

function formatCommunicatedAt(value: string): string {
  return value.replace("T", " · ");
}

function SearchFeedback({ state }: { state: StationSearchState }) {
  if (state.status === "loading") return <p className="search-feedback" role="status" aria-live="polite">Aggiorno i distributori vicini…</p>;
  if (state.status === "error") return <p className="search-feedback search-feedback--error" role="alert">{state.message}</p>;
  if (state.status === "empty") return <p className="search-feedback" role="status">Nessun prezzo corrisponde ai filtri scelti.</p>;
  return null;
}

export function FuelRadarShell() {
  const resultsRef = useRef<HTMLElement>(null);
  const municipalityInputRef = useRef<HTMLInputElement>(null);
  const userLocationRequest = useRef(false);
  const municipalityProvider = useRef<ReturnType<typeof createMunicipalityProvider> | null>(null);
  const municipalityRequest = useRef(0);
  const searchRequest = useRef(0);
  const resultButtons = useRef(new Map<string, HTMLButtonElement>());
  const [municipalityQuery, setMunicipalityQuery] = useState("");
  const [municipalities, setMunicipalities] = useState<readonly MunicipalitySuggestion[]>([]);
  const [activeMunicipalityIndex, setActiveMunicipalityIndex] = useState(-1);
  const [municipalityError, setMunicipalityError] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<StationSearchState>(INITIAL_STATION_SEARCH_STATE);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [detailStationId, setDetailStationId] = useState<string | null>(null);
  const [viewportOrigin, setViewportOrigin] = useState<(SearchOrigin & { sourceKey: string }) | null>(null);
  const preferences = useBrowserPreferences();
  const radiusKm = normalizeSearchRadiusKm(preferences.radiusKm);
  const [searchRadiusKm, setSearchRadiusKm] = useState(radiusKm);
  const geolocation = useBrowserGeolocationState();
  const freshness = useGpsFreshness();
  const online = useSyncExternalStore(subscribeOnline, browserOnline, serverOnline);
  const origin = preferredSearchOrigin(preferences);
  const originLatitude = origin?.latitude;
  const originLongitude = origin?.longitude;
  const savedOriginKey = origin
    ? `${origin.source}:${origin.latitude}:${origin.longitude}`
    : null;
  const viewportMatchesSavedOrigin =
    viewportOrigin?.sourceKey === savedOriginKey;
  const queryLatitude = viewportMatchesSavedOrigin
    ? viewportOrigin.latitude
    : originLatitude;
  const queryLongitude = viewportMatchesSavedOrigin
    ? viewportOrigin.longitude
    : originLongitude;
  const queryOrigin =
    queryLatitude === undefined || queryLongitude === undefined
      ? null
      : { latitude: queryLatitude, longitude: queryLongitude };
  const mapOrigin =
    originLatitude === undefined || originLongitude === undefined
      ? null
      : { latitude: originLatitude, longitude: originLongitude };
  const gpsPosition = preferences.lastGpsPosition ? { latitude: preferences.lastGpsPosition.latitude, longitude: preferences.lastGpsPosition.longitude, accuracyMeters: preferences.lastGpsPosition.accuracyMeters } : null;
  const viewState = resolveShellViewState({ online, geolocation, hasOrigin: origin !== null });
  const isLocating =
    geolocation === "checking-permission" || geolocation === "requesting";
  const gpsUnavailable = geolocation === "insecure" || geolocation === "unsupported";
  const errorMessage = viewState === "error" && geolocation === "insecure"
    ? "Il GPS richiede una connessione sicura. Puoi proseguire scegliendo un comune."
    : viewState === "error" && geolocation === "unsupported"
      ? "Questo dispositivo non supporta il GPS. Puoi proseguire scegliendo un comune."
      : undefined;
  const markers = useMemo(
    () => (searchState.status === "ready" ? stationResultMarkers(searchState.result.stations) : []),
    [searchState],
  );
  const nearbyStationsById = useMemo(
    () => new Map(
      searchState.status === "ready"
        ? searchState.result.stations.map((station) => [station.id, station] as const)
        : [],
    ),
    [searchState],
  );

  useEffect(() => {
    if (preferences.radiusKm !== radiusKm) {
      browserPreferenceStore.update({ radiusKm });
    }
  }, [preferences.radiusKm, radiusKm]);

  useEffect(() => {
    if (radiusKm === searchRadiusKm) return;
    const timer = window.setTimeout(() => {
      setSearchRadiusKm(radiusKm);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [radiusKm, searchRadiusKm]);

  useEffect(() => {
    if (!online || queryLatitude === undefined || queryLongitude === undefined) {
      searchRequest.current += 1;
      setSearchState({ status: "idle", requestId: searchRequest.current });
      return;
    }
    const controller = new AbortController();
    const requestId = searchRequest.current + 1;
    searchRequest.current = requestId;
    setSelectedStationId(null);
    setSearchState((current) => stationSearchReducer(current, { type: "start", requestId }));
    void fetchStationSearch({
      origin: { latitude: queryLatitude, longitude: queryLongitude },
      radiusKm: searchRadiusKm,
      fuelType: preferences.fuelType,
      serviceMode: preferences.serviceMode,
    }, { signal: controller.signal })
      .then((result) => setSearchState((current) => stationSearchReducer(current, { type: "success", requestId, result })))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Impossibile caricare i distributori.";
        setSearchState((current) => stationSearchReducer(current, { type: "failure", requestId, message }));
      });
    return () => controller.abort();
  }, [
    preferences.fuelType,
    preferences.serviceMode,
    queryLatitude,
    queryLongitude,
    online,
    searchRadiusKm,
  ]);

  useEffect(() => {
    if (viewState !== "ready" || !userLocationRequest.current) return;
    userLocationRequest.current = false;
    resultsRef.current?.focus();
  }, [viewState]);

  useEffect(() => {
    const query = municipalityQuery.trim();
    if (query.length < 2) return;
    const requestId = municipalityRequest.current + 1;
    municipalityRequest.current = requestId;
    const timer = window.setTimeout(() => {
      municipalityProvider.current ??= createMunicipalityProvider();
      void municipalityProvider.current.search(query, { limit: 8 })
        .then((next) => {
          if (municipalityRequest.current === requestId) {
            setMunicipalities(next);
            setActiveMunicipalityIndex(next.length > 0 ? 0 : -1);
            setMunicipalityError(null);
          }
        })
        .catch(() => {
          if (municipalityRequest.current === requestId) {
            setMunicipalities([]);
            setActiveMunicipalityIndex(-1);
            setMunicipalityError("Impossibile caricare l’elenco dei comuni. Riprova.");
          }
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [municipalityQuery]);

  const activeSelectedStationId =
    searchState.status === "ready" &&
    searchState.result.stations.some((station) => station.id === selectedStationId)
      ? selectedStationId
      : null;

  function requestLocation(): void {
    userLocationRequest.current = true;
    requestBrowserGeolocation();
  }

  function chooseMunicipality(municipality: MunicipalitySuggestion): void {
    if (!selectBrowserMunicipality(municipality)) return;
    municipalityRequest.current += 1;
    setMunicipalityQuery(`${municipality.name} (${municipality.province})`);
    setMunicipalities([]);
    setActiveMunicipalityIndex(-1);
    municipalityInputRef.current?.focus();
  }

  function updateMunicipalityQuery(value: string): void {
    setMunicipalityQuery(value);
    if (value.trim().length < 2) {
      municipalityRequest.current += 1;
      setMunicipalities([]);
      setActiveMunicipalityIndex(-1);
      setMunicipalityError(null);
    }
  }

  const hasResults = searchState.status === "ready";
  const hasSearchResponse =
    searchState.status === "ready" || searchState.status === "empty";
  function handleMunicipalityKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveMunicipalityIndex((current) => nextComboboxIndex(current, municipalities.length, event.key === "ArrowDown" ? "next" : "previous"));
    } else if (event.key === "Escape") {
      municipalityRequest.current += 1;
      setMunicipalities([]);
      setActiveMunicipalityIndex(-1);
    } else if (event.key === "Enter" && activeMunicipalityIndex >= 0) {
      const municipality = municipalities[activeMunicipalityIndex];
      if (municipality) {
        event.preventDefault();
        chooseMunicipality(municipality);
      }
    }
  }

  function handleViewportChange(viewport: { center: SearchOrigin }): void {
    if (!savedOriginKey) return;
    const active = queryOrigin;
    if (!viewportCenterChanged(active, viewport.center)) return;
    setViewportOrigin({ ...viewport.center, sourceKey: savedOriginKey });
  }

  const openStationDetail = useCallback((stationId: string): void => {
    setSelectedStationId(stationId);
    setDetailStationId(stationId);
  }, []);

  const openStationDetailFromMarker = useCallback((stationId: string): void => {
    resultButtons.current.get(stationId)?.focus();
    setSelectedStationId(stationId);
    setDetailStationId(stationId);
  }, []);

  const closeStationDetail = useCallback((): void => {
    setDetailStationId(null);
  }, []);

  const openStationDetailFromHistory = useCallback((stationId: string): void => {
    setSelectedStationId(stationId);
    setDetailStationId(stationId);
  }, []);

  const toggleFavorite = useCallback((stationId: string): void => {
    browserPreferenceStore.update((current) => ({
      ...current,
      favorites: toggleFavoriteIds(current.favorites, stationId),
    }));
  }, []);

  return (
    <div className="app-shell" id="top">
      <a className="skip-link" href="#workspace">Vai al contenuto</a>
      <header className="app-header">
        <a className="brand" href="#top" aria-label={`${SITE_NAME}, inizio pagina`}><Image src="/logo.png" alt="" width={48} height={48} priority /><span>{SITE_NAME}</span></a>
        <nav aria-label="Navigazione principale"><a href="#map">Mappa</a><a href="#results">Risultati</a><a href="#favorites">Preferiti</a></nav>
      </header>
      <main className="app-workspace" id="workspace">
        <section className="map-stage" id="map" tabIndex={-1} aria-labelledby="map-title">
          <h1 className="visually-hidden" id="map-title">{SITE_TAGLINE}</h1>
          <DynamicFuelMap provider={OPENSTREETMAP_TILE_PROVIDER} origin={mapOrigin} searchCenter={queryOrigin ? { latitude: queryOrigin.latitude, longitude: queryOrigin.longitude } : null} gpsPosition={gpsPosition} radiusKm={radiusKm} priceMarkers={markers} selectedMarkerId={activeSelectedStationId} onMarkerSelect={openStationDetailFromMarker} onViewportChange={handleViewportChange} />
          <section ref={resultsRef} className="results-sheet" id="results" tabIndex={-1} aria-labelledby="results-title">
            <p className="eyebrow">{SITE_TAGLINE}</p>
            <ShellStatePanel state={viewState} message={errorMessage} />

            <div className="search-controls" aria-label="Filtri della ricerca">
              <div className="municipality-field">
                <label htmlFor="municipality-search">Cerca un comune</label>
                <input ref={municipalityInputRef} id="municipality-search" value={municipalityQuery} type="search" role="combobox" aria-autocomplete="list" aria-expanded={municipalities.length > 0} aria-controls="municipality-options" aria-activedescendant={activeMunicipalityIndex >= 0 ? `municipality-option-${activeMunicipalityIndex}` : undefined} aria-describedby="municipality-help" onChange={(event) => updateMunicipalityQuery(event.target.value)} onKeyDown={handleMunicipalityKeyDown} placeholder="Es. Roma o Milano" />
                <p id="municipality-help">Comune, provincia e regione. L’elenco viene caricato solo quando cerchi.</p>
                {municipalities.length > 0 ? <ul className="municipality-options" id="municipality-options" role="listbox" aria-label="Comuni trovati">{municipalities.map((municipality, index) => <li key={municipality.id} id={`municipality-option-${index}`} role="option" aria-selected={activeMunicipalityIndex === index} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseMunicipality(municipality)}>{municipality.name}<span>{municipality.province} · {municipality.region}</span></li>)}</ul> : null}
                {municipalityError ? <p className="field-error" role="alert">{municipalityError}</p> : null}
              </div>
              <button className="gps-action" type="button" aria-busy={isLocating} disabled={isLocating || gpsUnavailable} onClick={requestLocation}>{isLocating ? "Ricerca GPS in corso…" : gpsUnavailable ? "GPS non disponibile" : "Usa la mia posizione GPS"}</button>
              <fieldset><legend>Carburante</legend><div className="filter-options">{(Object.keys(FUEL_LABELS) as FuelType[]).map((fuelType) => <label key={fuelType}><input type="radio" name="fuel-type" checked={preferences.fuelType === fuelType} onChange={() => browserPreferenceStore.update({ fuelType })} />{FUEL_LABELS[fuelType]}</label>)}</div></fieldset>
              <fieldset><legend>Servizio</legend><div className="filter-options">{(Object.keys(SERVICE_LABELS) as ServiceMode[]).map((serviceMode) => <label key={serviceMode}><input type="radio" name="service-mode" checked={preferences.serviceMode === serviceMode} onChange={() => browserPreferenceStore.update({ serviceMode })} />{SERVICE_LABELS[serviceMode]}</label>)}</div></fieldset>
              <label className="radius-control" htmlFor="radius-km">Raggio <output htmlFor="radius-km">{radiusKm} km</output><input id="radius-km" type="range" min={SEARCH_RADIUS_MIN_KM} max={SEARCH_RADIUS_MAX_KM} step="1" value={radiusKm} onChange={(event) => browserPreferenceStore.update({ radiusKm: Number(event.target.value) })} /></label>
            </div>

            {origin?.source === "gps" ? <p className="location-summary">{freshness.status === "stale" ? "Ultima posizione GPS nota" : geolocation === "watching" ? "Posizione GPS aggiornata" : "Posizione GPS salvata"} · accuratezza ±{Math.round(origin.accuracyMeters)} m</p> : origin?.source === "municipality" ? <p className="location-summary">Ricerca da {origin.municipality.name}, {origin.municipality.province} · {origin.municipality.region}</p> : null}
            {!origin ? <p className="location-actions">Scegli un comune o usa il GPS per avviare la ricerca.</p> : null}
            <section className="favorites" id="favorites" aria-labelledby="favorites-title">
              <h2 id="favorites-title">Preferiti <span>{preferences.favorites.length}</span></h2>
              {preferences.favorites.length > 0 ? (
                <ul>
                  {preferences.favorites.map((stationId) => {
                    const nearby = nearbyStationsById.get(stationId);
                    const label = nearby?.name || nearby?.brand || nearby?.operator || `Distributore ${stationId}`;
                    return <li key={stationId}><button type="button" onClick={() => openStationDetail(stationId)}><strong>{label}</strong><span>{nearby ? `${nearby.address}, ${nearby.city}` : "Apri il dettaglio salvato"}</span></button></li>;
                  })}
                </ul>
              ) : <p>I distributori che salvi restano disponibili su questo dispositivo.</p>}
            </section>
            <SearchFeedback state={searchState} />
            {hasSearchResponse ? <>
              <p className={`dataset-status${searchState.result.freshness.status === "stale" ? " dataset-status--stale" : ""}`} role={searchState.result.freshness.status === "stale" ? "status" : undefined}>Dati del dataset estratti il {searchState.result.extractionDate}{searchState.result.freshness.status === "stale" ? ` · aggiornamento non recente (${searchState.result.freshness.ageDays} giorni)` : ""}.</p>
              {hasResults ? <><p className="results-count">{searchState.result.stations.length} {searchState.result.stations.length === 1 ? "distributore" : "distributori"} nell’ordine dell’API: prezzo, distanza e identificativo.</p>
              <ul className="station-results" aria-label="Distributori trovati">{searchState.result.stations.map((station) => <li key={station.id}><button ref={(element) => { if (element) resultButtons.current.set(station.id, element); else resultButtons.current.delete(station.id); }} className={activeSelectedStationId === station.id ? "station-result station-result--selected" : "station-result"} type="button" aria-pressed={activeSelectedStationId === station.id} onClick={() => openStationDetail(station.id)}><span className="station-result__top"><strong>{formatFuelPrice(station.price)}</strong><span>{formatDistance(station.distanceKm)}</span></span><span className="station-result__brand">{station.brand || station.operator || "Marchio non comunicato"}</span><span>{station.address}, {station.city} ({station.province})</span><small>Prezzo comunicato: {formatCommunicatedAt(station.communicatedAt)}</small></button></li>)}</ul></> : null}
            </> : null}
          </section>
        </section>
      </main>
      <StationDetailPanel
        stationId={detailStationId}
        nearbyStation={detailStationId ? nearbyStationsById.get(detailStationId) ?? null : null}
        favorite={detailStationId ? preferences.favorites.includes(detailStationId) : false}
        favoriteLimitReached={preferences.favorites.length >= MAX_FAVORITES}
        online={online}
        fallbackFocusRef={resultsRef}
        onRequestOpen={openStationDetailFromHistory}
        onRequestClose={closeStationDetail}
        onToggleFavorite={toggleFavorite}
      />
    </div>
  );
}
