"use client";

import L from "leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import {
  AttributionControl,
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { useEffect, useRef, useState } from "react";

import {
  tileAttributionHtml,
  validateTileProvider,
  type TileProvider,
} from "@/map/config";
import { createDebouncedCallback } from "@/map/debounce";
import {
  formatFuelPrice,
  type MapPosition,
  type PriceMarker,
} from "@/map/price-marker";

export type MapViewport = {
  readonly center: MapPosition;
  readonly zoom: number;
  readonly bounds: {
    readonly north: number;
    readonly south: number;
    readonly east: number;
    readonly west: number;
  };
};

export type FuelMapProps = {
  readonly provider: TileProvider;
  readonly origin: MapPosition | null;
  readonly gpsPosition?: (MapPosition & { readonly accuracyMeters: number }) | null;
  readonly radiusKm: number;
  readonly priceMarkers?: readonly PriceMarker[];
  readonly onViewportChange?: (viewport: MapViewport) => void;
};

const ITALY_CENTER: MapPosition = { latitude: 42.504154, longitude: 12.646361 };
const DEFAULT_ZOOM = 5;
const MAX_SEARCH_ZOOM = 13;
const VIEWPORT_DEBOUNCE_MS = 250;

function latLng(position: MapPosition): L.LatLngExpression {
  return [position.latitude, position.longitude];
}

function MapAccessibility() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "Mappa interattiva dei distributori");
    container.setAttribute("aria-describedby", "map-keyboard-help");
    return () => {
      container.removeAttribute("role");
      container.removeAttribute("aria-label");
      container.removeAttribute("aria-describedby");
    };
  }, [map]);
  return null;
}

function PriceMarkerPin({ marker }: { marker: PriceMarker }) {
  const priceLabel = formatFuelPrice(marker.price);
  const priceContent = document.createElement("span");
  priceContent.textContent = priceLabel;
  const icon = L.divIcon({
    className: "price-marker-icon",
    html: priceContent,
    iconSize: [74, 32],
    iconAnchor: [37, 32],
  });
  return (
    <Marker
      position={latLng(marker.position)}
      icon={icon}
      title={marker.name}
      alt={`${marker.name}, ${priceLabel}`}
    >
      <Popup>
        <strong>{marker.name}</strong>
        <br />
        {priceLabel} · {marker.fuelType} {marker.serviceMode}
        <br />
        {marker.address}
      </Popup>
    </Marker>
  );
}

/** MapContainer options are immutable: only this child updates the view. */
function ControlledSearchView({
  center,
  radiusKm,
}: {
  center: MapPosition | null;
  radiusKm: number;
}) {
  const map = useMap();
  const hasCenter = center !== null;
  const latitude = center?.latitude ?? ITALY_CENTER.latitude;
  const longitude = center?.longitude ?? ITALY_CENTER.longitude;

  useEffect(() => {
    function updateView(): void {
      if (!hasCenter) {
        map.setView([latitude, longitude], DEFAULT_ZOOM, { animate: false });
        return;
      }
      const size = map.getSize();
      const desktop = size.x >= 760;
      const mobileSheetSpace = Math.min(
        400,
        Math.max(180, Math.round(size.y * 0.52)),
      );
      const bounds = L.latLng(latitude, longitude).toBounds(radiusKm * 2_000);
      map.fitBounds(bounds, {
        animate: false,
        maxZoom: MAX_SEARCH_ZOOM,
        paddingTopLeft: [16, 16],
        paddingBottomRight: desktop ? [414, 16] : [16, mobileSheetSpace],
      });
    }

    updateView();
    map.on("resize", updateView);
    return () => {
      map.off("resize", updateView);
    };
  }, [hasCenter, latitude, longitude, map, radiusKm]);
  return null;
}

function ViewportReporter({
  onViewportChange,
}: {
  onViewportChange?: (viewport: MapViewport) => void;
}) {
  const callbackRef = useRef(onViewportChange);
  const debounceRef = useRef<ReturnType<typeof createDebouncedCallback<MapViewport>> | null>(null);

  useEffect(() => {
    callbackRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    const debounced = createDebouncedCallback<MapViewport>((viewport) => {
      callbackRef.current?.(viewport);
    }, VIEWPORT_DEBOUNCE_MS);
    debounceRef.current = debounced;
    return () => {
      debounced.cancel();
      if (debounceRef.current === debounced) debounceRef.current = null;
    };
  }, []);

  const map = useMapEvents({
    moveend() {
      const center = map.getCenter();
      const bounds = map.getBounds();
      debounceRef.current?.call({
        center: { latitude: center.lat, longitude: center.lng },
        zoom: map.getZoom(),
        bounds: {
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
        },
      });
    },
  });

  return null;
}

function SearchCenter({ center, radiusKm }: { center: MapPosition; radiusKm: number }) {
  return (
    <>
      <Circle
        center={latLng(center)}
        radius={radiusKm * 1_000}
        pathOptions={{ color: "#174f2c", fillColor: "#7f9b84", fillOpacity: 0.13, weight: 2 }}
      />
      <CircleMarker
        center={latLng(center)}
        radius={8}
        pathOptions={{ color: "#ffffff", fillColor: "#174f2c", fillOpacity: 1, weight: 3 }}
      >
        <Popup>Centro della ricerca</Popup>
      </CircleMarker>
    </>
  );
}

function GpsPosition({
  position,
}: {
  position: MapPosition & { readonly accuracyMeters: number };
}) {
  return (
    <>
      <Circle
        center={latLng(position)}
        radius={position.accuracyMeters}
        pathOptions={{ color: "#1769aa", fillColor: "#5ca9df", fillOpacity: 0.1, weight: 1 }}
      />
      <CircleMarker
        center={latLng(position)}
        radius={5}
        pathOptions={{ color: "#ffffff", fillColor: "#1769aa", fillOpacity: 1, weight: 2 }}
      >
        <Popup>Ultima posizione GPS disponibile</Popup>
      </CircleMarker>
    </>
  );
}

export function FuelMap({
  provider,
  origin,
  gpsPosition = null,
  radiusKm,
  priceMarkers = [],
  onViewportChange,
}: FuelMapProps) {
  const [failedProvider, setFailedProvider] = useState<string | null>(null);
  const [tileAttempt, setTileAttempt] = useState(0);
  const tileBatchFailed = useRef(false);
  const configuredProvider = validateTileProvider(provider);
  const center = mapCenterFromOrigin(origin);
  const providerKey = `${configuredProvider.id}:${configuredProvider.url}`;
  const tilesFailed = failedProvider === providerKey;

  return (
    <div className="fuel-map">
      <p className="visually-hidden" id="map-keyboard-help">
        Mappa interattiva: il cerchio verde indica l’area di ricerca
        {gpsPosition ? " e il punto blu l’ultima posizione GPS" : ""}. Usa i
        tasti freccia per spostarti e più o meno per cambiare zoom.
      </p>
      <MapContainer
        center={latLng(center)}
        zoom={DEFAULT_ZOOM}
        minZoom={configuredProvider.minZoom}
        maxZoom={configuredProvider.maxZoom}
        scrollWheelZoom
        attributionControl={false}
        className="fuel-map__canvas"
      >
        <MapAccessibility />
        <AttributionControl position="topleft" prefix={false} />
        <TileLayer
          key={`${providerKey}:${tileAttempt}`}
          url={configuredProvider.url}
          minZoom={configuredProvider.minZoom}
          maxZoom={configuredProvider.maxZoom}
          attribution={tileAttributionHtml(configuredProvider)}
          eventHandlers={{
            loading: () => {
              tileBatchFailed.current = false;
            },
            tileerror: () => {
              tileBatchFailed.current = true;
            },
            load: () => {
              setFailedProvider(tileBatchFailed.current ? providerKey : null);
            },
          }}
        />
        <ControlledSearchView center={origin} radiusKm={radiusKm} />
        <ViewportReporter onViewportChange={onViewportChange} />
        {origin ? <SearchCenter center={origin} radiusKm={radiusKm} /> : null}
        {gpsPosition ? <GpsPosition position={gpsPosition} /> : null}
        <MarkerClusterGroup chunkedLoading>
          {priceMarkers.map((marker) => (
            <PriceMarkerPin key={marker.id} marker={marker} />
          ))}
        </MarkerClusterGroup>
      </MapContainer>
      {tilesFailed ? (
        <div className="map-tile-error" role="status" aria-live="polite">
          <span>
            Impossibile caricare la mappa. Controlla la connessione; la ricerca resta disponibile.
          </span>
          <button
            type="button"
            onClick={() => {
              setFailedProvider(null);
              setTileAttempt((attempt) => attempt + 1);
            }}
          >
            Riprova mappa
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function mapCenterFromOrigin(origin: MapPosition | null): MapPosition {
  return origin ?? ITALY_CENTER;
}
