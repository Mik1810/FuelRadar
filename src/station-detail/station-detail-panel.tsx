"use client";

import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { PublicNearbyStation } from "@/domain/public-api";
import type { FuelType, ServiceMode } from "@/domain/fuel";
import {
  stationDialogHistoryState,
  stationIdFromHistoryState,
} from "@/navigation/dialog-history";
import {
  appleMapsDirectionsUrl,
  fetchStationDetail,
  formatStationPrice,
  googleMapsDirectionsUrl,
  INITIAL_STATION_DETAIL_STATE,
  stationDetailReducer,
  supportsAppleMaps,
} from "@/station-detail/station-detail";

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

function formatDistance(distanceKm: number | null): string {
  if (distanceKm === null) return "Distanza non disponibile fuori dalla ricerca corrente";
  return distanceKm < 1
    ? `${Math.round(distanceKm * 1_000)} m dalla posizione di ricerca`
    : `${distanceKm.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km dalla posizione di ricerca`;
}

function formatCommunicatedAt(value: string): string {
  const [date, time] = value.split("T");
  return `${date} alle ${time}`;
}

export type StationDetailPanelProps = {
  stationId: string | null;
  nearbyStation: PublicNearbyStation | null;
  favorite: boolean;
  favoriteLimitReached: boolean;
  online: boolean;
  fallbackFocusRef: RefObject<HTMLElement | null>;
  onRequestOpen: (stationId: string) => void;
  onRequestClose: () => void;
  onToggleFavorite: (stationId: string) => void;
};

export function StationDetailPanel({
  stationId,
  nearbyStation,
  favorite,
  favoriteLimitReached,
  online,
  fallbackFocusRef,
  onRequestOpen,
  onRequestClose,
  onToggleFavorite,
}: StationDetailPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const requestIdRef = useRef(0);
  const closingRef = useRef(false);
  const [state, dispatch] = useReducer(stationDetailReducer, INITIAL_STATION_DETAIL_STATE);
  const [retry, setRetry] = useState(0);
  const [appleMaps, setAppleMaps] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppleMaps(supportsAppleMaps(navigator.userAgent));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!stationId) {
      if (dialog.open) dialog.close();
      closingRef.current = false;
      requestIdRef.current += 1;
      dispatch({ type: "close", requestId: requestIdRef.current });
      return;
    }

    if (!dialog.open) {
      closingRef.current = false;
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      dialog.showModal();
    }
    if (stationIdFromHistoryState(history.state) !== stationId) {
      history.pushState(stationDialogHistoryState(history.state, stationId), "");
    }
  }, [stationId]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      closingRef.current = false;
      const historyStationId = stationIdFromHistoryState(event.state);
      if (historyStationId) {
        if (historyStationId !== stationId) onRequestOpen(historyStationId);
      } else if (stationId) {
        onRequestClose();
      }
    };
    window.addEventListener("popstate", handlePopState);
    if (!stationId) {
      const historyStationId = stationIdFromHistoryState(history.state);
      if (historyStationId) onRequestOpen(historyStationId);
    }
    return () => window.removeEventListener("popstate", handlePopState);
  }, [onRequestClose, onRequestOpen, stationId]);

  useEffect(() => {
    if (!stationId) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    dispatch({ type: "start", requestId, stationId });
    if (!online) {
      dispatch({ type: "failure", requestId, stationId, message: "Sei offline. Riconnettiti per caricare il dettaglio." });
      return;
    }
    const controller = new AbortController();
    void fetchStationDetail(stationId, { signal: controller.signal })
      .then((result) => {
        if (result.status === "missing") {
          dispatch({ type: "missing", requestId, stationId });
        } else {
          dispatch({ type: "success", requestId, detail: result.detail });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          type: "failure",
          requestId,
          stationId,
          message: error instanceof Error ? error.message : "Impossibile caricare il distributore.",
        });
      });
    return () => controller.abort();
  }, [online, retry, stationId]);

  function closeFromUserAction(): void {
    if (closingRef.current) return;
    closingRef.current = true;
    if (stationId && stationIdFromHistoryState(history.state) === stationId) {
      history.back();
    } else {
      onRequestClose();
    }
  }

  function restoreFocus(): void {
    const returnTarget = returnFocusRef.current;
    if (returnTarget?.isConnected) returnTarget.focus();
    else fallbackFocusRef.current?.focus();
    returnFocusRef.current = null;
  }

  const detail = state.status === "ready" ? state.detail : null;
  const station = detail?.station;
  const title = station
    ? station.name || station.brand || station.operator || `Distributore ${station.id}`
    : nearbyStation?.name || nearbyStation?.brand || nearbyStation?.operator || "Dettaglio distributore";

  return (
    <dialog
      ref={dialogRef}
      className="station-dialog"
      aria-labelledby="station-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        closeFromUserAction();
      }}
      onClose={restoreFocus}
    >
      <div className="station-dialog__header">
        <div>
          <p className="eyebrow">Scheda distributore</p>
          <h2 id="station-dialog-title">{title}</h2>
        </div>
        <button type="button" className="station-dialog__close" onClick={closeFromUserAction} aria-label="Chiudi il dettaglio">×</button>
      </div>

      {stationId ? (
        <button
          type="button"
          className={favorite ? "favorite-action favorite-action--active" : "favorite-action"}
          aria-pressed={favorite}
          disabled={!favorite && favoriteLimitReached}
          onClick={() => onToggleFavorite(stationId)}
        >
          <span aria-hidden="true">{favorite ? "★" : "☆"}</span>
          {favorite
            ? "Rimuovi dai preferiti"
            : favoriteLimitReached
              ? "Limite preferiti raggiunto"
              : "Aggiungi ai preferiti"}
        </button>
      ) : null}

      <div id="station-dialog-status" className="station-dialog__content">
        {state.status === "loading" ? <p role="status" aria-live="polite">Caricamento del dettaglio…</p> : null}
        {state.status === "missing" ? (
          <div className="station-detail-message" role="status">
            <h3>Distributore non più disponibile</h3>
            <p>Questo identificativo non è presente nel dataset attivo. Il preferito resta salvato finché non decidi di rimuoverlo.</p>
          </div>
        ) : null}
        {state.status === "error" ? (
          <div className="station-detail-message station-detail-message--error" role="alert">
            <p>{state.message}</p>
            <button type="button" onClick={() => setRetry((value) => value + 1)} disabled={!online}>Riprova</button>
          </div>
        ) : null}
        {detail && station ? (
          <>
            <div className="station-detail-summary">
              <p><strong>{station.brand || "Marchio non comunicato"}</strong>{station.operator ? ` · ${station.operator}` : ""}</p>
              <p>{station.address}, {station.city} ({station.province})</p>
              <p>{formatDistance(nearbyStation?.distanceKm ?? null)}</p>
            </div>

            <section aria-labelledby="station-prices-title">
              <h3 id="station-prices-title">Prezzi comunicati</h3>
              {station.prices.length > 0 ? (
                <ul className="station-price-list">
                  {station.prices.map((price) => (
                    <li key={`${price.fuelType}-${price.serviceMode}`}>
                      <span><strong>{FUEL_LABELS[price.fuelType]}</strong><small>{SERVICE_LABELS[price.serviceMode]}</small></span>
                      <span><strong>{formatStationPrice(price.price, price.fuelType)}</strong><small>Comunicazione del <time dateTime={price.communicatedAt}>{formatCommunicatedAt(price.communicatedAt)}</time></small></span>
                    </li>
                  ))}
                </ul>
              ) : <p>Nessun prezzo comunicato per questo distributore.</p>}
            </section>

            <p className={detail.freshness.status === "stale" ? "dataset-status dataset-status--stale" : "dataset-status"}>
              Dataset estratto il <time dateTime={detail.extractionDate}>{detail.extractionDate}</time>
              {detail.freshness.status === "stale" ? ` · non recente (${detail.freshness.ageDays} giorni)` : ""}.
            </p>

            <div className="directions-actions" aria-label="Indicazioni stradali">
              <a href={googleMapsDirectionsUrl(station.latitude, station.longitude).href} target="_blank" rel="noopener noreferrer">Apri in Google Maps</a>
              {appleMaps ? <a href={appleMapsDirectionsUrl(station.latitude, station.longitude).href} target="_blank" rel="noopener noreferrer">Apri in Mappe Apple</a> : null}
            </div>
          </>
        ) : null}
      </div>
    </dialog>
  );
}
