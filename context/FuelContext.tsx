import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { gasStationsFromFuelRadarDataset, type FuelRadarDataset } from "@/data/fuelRadarData";
import {
  type FuelRadarDatasetQuery,
  loadFavoriteFuelRadarDataset,
  loadFuelRadarDatasetForQuery,
  refreshLocalFuelRadarDatasetFromMimit,
} from "@/data/fuelRadarRepository";

export type FuelType = "benzina" | "diesel" | "metano" | "gpl";
export type ServiceMode = "self" | "served";

export interface FuelPrice {
  type: FuelType;
  selfService: number;
  served?: number;
}

export interface GasStation {
  id: string;
  name: string;
  brand: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  prices: FuelPrice[];
  isFavorite: boolean;
  lastUpdated: string;
  distance?: number;
}

export interface SavedLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export const FUEL_LABELS: Record<FuelType, string> = {
  benzina: "Benzina",
  diesel: "Diesel",
  metano: "Metano",
  gpl: "GPL",
};

export const FUEL_COLORS: Record<FuelType, string> = {
  benzina: "#FF6B35",
  diesel: "#3B82F6",
  metano: "#22C55E",
  gpl: "#A855F7",
};

const DEFAULT_RADIUS_KM = 15;
const DEFAULT_MAP_CENTER = {
  latitude: 41.9028,
  longitude: 12.4964,
};

interface FuelContextType {
  stations: GasStation[];
  selectedFuelType: FuelType;
  setSelectedFuelType: (type: FuelType) => void;
  selectedServiceMode: ServiceMode;
  setSelectedServiceMode: (mode: ServiceMode) => void;
  radiusKm: number;
  setRadiusKm: (radiusKm: number) => void;
  toggleFavorite: (id: string) => void;
  filteredStations: GasStation[];
  favoritesStations: GasStation[];
  userLocation: { latitude: number; longitude: number } | null;
  setUserLocation: (loc: { latitude: number; longitude: number } | null) => void;
  savedLocations: SavedLocation[];
  selectedLocation: SavedLocation | null;
  setSelectedLocation: (loc: SavedLocation | null) => void;
  addSavedLocation: (loc: Omit<SavedLocation, "id">) => void;
  removeSavedLocation: (id: string) => void;
  mapCenter: { latitude: number; longitude: number } | null;
  visibleMapCenter: { latitude: number; longitude: number } | null;
  setVisibleMapCenter: (loc: { latitude: number; longitude: number } | null) => void;
  focusedStationId: string | null;
  setFocusedStationId: (id: string | null) => void;
  isLoading: boolean;
  isUsingLiveData: boolean;
  dataError: string | null;
  refetch: () => void;
  cachedAt: string | null;
}

const FuelContext = createContext<FuelContextType | null>(null);

const EMPTY_FUELRADAR_DATASET: FuelRadarDataset = {
  extractionDate: "",
  stations: [],
  prices: [],
};

export function useFuel() {
  const ctx = useContext(FuelContext);
  if (!ctx) throw new Error("useFuel must be used within FuelProvider");
  return ctx;
}

export function getDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function mergeFavorites(
  stations: GasStation[],
  favorites: Set<string>
): GasStation[] {
  return stations.map((s) => ({ ...s, isFavorite: favorites.has(s.id) }));
}

function addDistanceFromCenter(
  stations: GasStation[],
  center: { latitude: number; longitude: number } | null
): GasStation[] {
  if (!center) return stations;

  return stations.map((station) => ({
    ...station,
    distance: getDistance(
      center.latitude,
      center.longitude,
      station.latitude,
      station.longitude
    ),
  }));
}

function hasFuelForServiceMode(
  station: GasStation,
  fuelType: FuelType,
  serviceMode: ServiceMode
): boolean {
  return station.prices.some(
    (price) =>
      price.type === fuelType &&
      (serviceMode === "self"
        ? Number.isFinite(price.selfService)
        : Number.isFinite(price.served))
  );
}

function getSelectedPriceValue(
  station: GasStation,
  fuelType: FuelType,
  serviceMode: ServiceMode
): number {
  const selectedPrice = station.prices.find((price) => price.type === fuelType);

  return serviceMode === "self"
    ? selectedPrice?.selfService ?? 999
    : selectedPrice?.served ?? 999;
}

function sortBySelectedPrice(
  stations: GasStation[],
  fuelType: FuelType,
  serviceMode: ServiceMode
): GasStation[] {
  return [...stations].sort(
    (a, b) =>
      getSelectedPriceValue(a, fuelType, serviceMode) -
      getSelectedPriceValue(b, fuelType, serviceMode)
  );
}

function getDatasetQuery(
  visibleMapCenter: { latitude: number; longitude: number } | null,
  selectedFuelType: FuelType,
  selectedServiceMode: ServiceMode,
  radiusKm: number
): FuelRadarDatasetQuery {
  if (!visibleMapCenter) return {};

  return {
    nearby: {
      latitude: visibleMapCenter.latitude,
      longitude: visibleMapCenter.longitude,
      radiusKm,
      fuelType: selectedFuelType,
      serviceMode: selectedServiceMode,
    },
  };
}

export function FuelProvider({ children }: { children: React.ReactNode }) {
  const [dataset, setDataset] = useState<FuelRadarDataset>(EMPTY_FUELRADAR_DATASET);
  const [favoriteDataset, setFavoriteDataset] = useState<FuelRadarDataset>(EMPTY_FUELRADAR_DATASET);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [selectedFuelType, setSelectedFuelType] = useState<FuelType>("benzina");
  const [selectedServiceMode, setSelectedServiceMode] = useState<ServiceMode>("self");
  const [radiusKm, setRadiusKmState] = useState(DEFAULT_RADIUS_KM);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<SavedLocation | null>(null);
  const [visibleMapCenter, setVisibleMapCenter] = useState<{
    latitude: number;
    longitude: number;
  } | null>(DEFAULT_MAP_CENTER);
  const [focusedStationId, setFocusedStationId] = useState<string | null>(null);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const datasetRequestIdRef = useRef(0);
  const favoriteRequestIdRef = useRef(0);
  const didStartRemoteRefreshRef = useRef(false);

  const mapCenter = useMemo(
    () =>
      selectedLocation
        ? { latitude: selectedLocation.latitude, longitude: selectedLocation.longitude }
        : userLocation,
    [selectedLocation, userLocation]
  );

  const currentDatasetQuery = useCallback(
    () =>
      getDatasetQuery(
        visibleMapCenter,
        selectedFuelType,
        selectedServiceMode,
        radiusKm
      ),
    [radiusKm, selectedFuelType, selectedServiceMode, visibleMapCenter]
  );

  const loadLocalData = useCallback(async () => {
    const requestId = ++datasetRequestIdRef.current;
    setIsLoadingData(true);
    setDatabaseError(null);

    try {
      const nextDataset = await loadFuelRadarDatasetForQuery(currentDatasetQuery());
      if (requestId === datasetRequestIdRef.current) {
        setDataset(nextDataset);
      }
    } catch (error: unknown) {
      if (requestId === datasetRequestIdRef.current) {
        setDataset(EMPTY_FUELRADAR_DATASET);
        setDatabaseError(
          error instanceof Error ? error.message : "Unable to load local database"
        );
      }
    } finally {
      if (requestId === datasetRequestIdRef.current) {
        setIsLoadingData(false);
      }
    }
  }, [currentDatasetQuery]);

  const refreshLocalData = useCallback(async () => {
    const requestId = ++datasetRequestIdRef.current;
    setIsLoadingData(true);
    setDatabaseError(null);

    try {
      const result = await refreshLocalFuelRadarDatasetFromMimit(currentDatasetQuery());
      if (requestId === datasetRequestIdRef.current) {
        setDataset(result.dataset);
      }
    } catch (error: unknown) {
      if (requestId === datasetRequestIdRef.current) {
        setDataset(EMPTY_FUELRADAR_DATASET);
        setDatabaseError(
          error instanceof Error ? error.message : "Unable to load local database"
        );
      }
    } finally {
      if (requestId === datasetRequestIdRef.current) {
        setIsLoadingData(false);
      }
    }
  }, [currentDatasetQuery]);

  useEffect(() => {
    void loadLocalData();
  }, [loadLocalData]);

  useEffect(() => {
    if (didStartRemoteRefreshRef.current) return;
    didStartRemoteRefreshRef.current = true;
    void refreshLocalData();
  }, [refreshLocalData]);

  useEffect(() => {
    const stationIds = [...favorites];
    const requestId = ++favoriteRequestIdRef.current;

    if (stationIds.length === 0) {
      setFavoriteDataset(EMPTY_FUELRADAR_DATASET);
      return;
    }

    const loadFavorites = async () => {
      try {
        const nextDataset = await loadFavoriteFuelRadarDataset(stationIds);
        if (requestId === favoriteRequestIdRef.current) {
          setFavoriteDataset(nextDataset);
        }
      } catch {
        // Keep the last successful favorite snapshot; current station data below
        // still provides an immediate optimistic row for newly favorited stations.
      }
    };

    void loadFavorites();
  }, [dataset, favorites]);

  useEffect(() => {
    const load = async () => {
      const [favsVal, locsVal, radiusVal] = await Promise.all([
        AsyncStorage.getItem("favorites"),
        AsyncStorage.getItem("savedLocations"),
        AsyncStorage.getItem("radiusKm"),
      ]);
      if (favsVal) {
        setFavorites(new Set(JSON.parse(favsVal) as string[]));
      }
      if (locsVal) {
        setSavedLocations(JSON.parse(locsVal));
      }
      if (radiusVal) {
        const parsedRadius = Number(radiusVal);
        if (
          parsedRadius >= 5 &&
          parsedRadius <= 50 &&
          parsedRadius % 5 === 0
        ) {
          setRadiusKmState(parsedRadius);
        }
      }
    };
    load();
  }, []);

  const setRadiusKm = useCallback((nextRadiusKm: number) => {
    setRadiusKmState(nextRadiusKm);
    AsyncStorage.setItem("radiusKm", String(nextRadiusKm));
  }, []);

  const toggleFavorite = useCallback(async (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      AsyncStorage.setItem("favorites", JSON.stringify([...next]));
      return next;
    });
    void loadLocalData();
  }, [loadLocalData]);

  const addSavedLocation = useCallback((loc: Omit<SavedLocation, "id">) => {
    const newLoc: SavedLocation = {
      ...loc,
      id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
    };
    setSavedLocations((prev) => {
      const updated = [...prev, newLoc];
      AsyncStorage.setItem("savedLocations", JSON.stringify(updated));
      return updated;
    });
    setSelectedLocation(newLoc);
  }, []);

  const removeSavedLocation = useCallback((id: string) => {
    setSavedLocations((prev) => {
      const updated = prev.filter((l) => l.id !== id);
      AsyncStorage.setItem("savedLocations", JSON.stringify(updated));
      return updated;
    });
    setSelectedLocation((cur) => (cur?.id === id ? null : cur));
  }, []);

  const stations = mergeFavorites(gasStationsFromFuelRadarDataset(dataset), favorites);
  const favoriteStations = mergeFavorites(
    gasStationsFromFuelRadarDataset(favoriteDataset),
    favorites
  );
  const stationsWithDistance = addDistanceFromCenter(stations, mapCenter);
  const favoriteStationsWithDistance = addDistanceFromCenter(favoriteStations, mapCenter);
  const favoriteStationsById = new Map<string, GasStation>();

  for (const station of favoriteStationsWithDistance) {
    if (station.isFavorite) favoriteStationsById.set(station.id, station);
  }
  for (const station of stationsWithDistance) {
    if (station.isFavorite) favoriteStationsById.set(station.id, station);
  }

  const filteredStations = sortBySelectedPrice(
    stationsWithDistance
      .filter((station) => station.distance === undefined || station.distance <= radiusKm)
      .filter((station) =>
        hasFuelForServiceMode(station, selectedFuelType, selectedServiceMode)
      ),
    selectedFuelType,
    selectedServiceMode
  );
  const favoritesStations = sortBySelectedPrice(
    [...favoriteStationsById.values()]
      .filter((station) =>
        hasFuelForServiceMode(station, selectedFuelType, selectedServiceMode)
      ),
    selectedFuelType,
    selectedServiceMode
  );

  return (
    <FuelContext.Provider
      value={{
        stations: stationsWithDistance,
        selectedFuelType,
        setSelectedFuelType,
        selectedServiceMode,
        setSelectedServiceMode,
        radiusKm,
        setRadiusKm,
        toggleFavorite,
        filteredStations,
        favoritesStations,
        userLocation,
        setUserLocation,
        savedLocations,
        selectedLocation,
        setSelectedLocation,
        addSavedLocation,
        removeSavedLocation,
        mapCenter,
        visibleMapCenter,
        setVisibleMapCenter,
        focusedStationId,
        setFocusedStationId,
        isLoading: isLoadingData,
        isUsingLiveData: false,
        dataError: databaseError,
        refetch: () => {
          void refreshLocalData();
        },
        cachedAt: dataset.extractionDate || null,
      }}
    >
      {children}
    </FuelContext.Provider>
  );
}
