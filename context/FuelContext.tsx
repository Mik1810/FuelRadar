import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { gasStationsFromFuelRadarDataset, type FuelRadarDataset } from "@/data/fuelRadarData";
import { SAMPLE_FUELRADAR_DATASET } from "@/data/generated/sampleFuelRadarDataset";

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

const RADIUS_KM = 15;

interface FuelContextType {
  stations: GasStation[];
  selectedFuelType: FuelType;
  setSelectedFuelType: (type: FuelType) => void;
  selectedServiceMode: ServiceMode;
  setSelectedServiceMode: (mode: ServiceMode) => void;
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
  isLoading: boolean;
  isUsingLiveData: boolean;
  dataError: string | null;
  refetch: () => void;
  cachedAt: string | null;
}

const FuelContext = createContext<FuelContextType | null>(null);

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

export function FuelProvider({ children }: { children: React.ReactNode }) {
  const [dataset, setDataset] = useState<FuelRadarDataset>(SAMPLE_FUELRADAR_DATASET);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [selectedFuelType, setSelectedFuelType] = useState<FuelType>("benzina");
  const [selectedServiceMode, setSelectedServiceMode] = useState<ServiceMode>("self");
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<SavedLocation | null>(null);

  useEffect(() => {
    const load = async () => {
      const [favsVal, locsVal] = await Promise.all([
        AsyncStorage.getItem("favorites"),
        AsyncStorage.getItem("savedLocations"),
      ]);
      if (favsVal) {
        setFavorites(new Set(JSON.parse(favsVal) as string[]));
      }
      if (locsVal) {
        setSavedLocations(JSON.parse(locsVal));
      }
    };
    load();
  }, []);

  const mapCenter = selectedLocation
    ? { latitude: selectedLocation.latitude, longitude: selectedLocation.longitude }
    : userLocation;

  const refreshLocalData = useCallback(() => {
    setDataset(SAMPLE_FUELRADAR_DATASET);
  }, []);

  const toggleFavorite = useCallback(async (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      AsyncStorage.setItem("favorites", JSON.stringify([...next]));
      return next;
    });
  }, []);

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

  const stationsWithDistance = stations.map((s) => {
    if (mapCenter) {
      return {
        ...s,
        distance: getDistance(
          mapCenter.latitude,
          mapCenter.longitude,
          s.latitude,
          s.longitude
        ),
      };
    }
    return s;
  });

  const filteredStations = stationsWithDistance
    .filter((s) =>
      s.prices.some(
        (p) =>
          p.type === selectedFuelType &&
          (selectedServiceMode === "self"
            ? Number.isFinite(p.selfService)
            : Number.isFinite(p.served))
      )
    )
    .sort((a, b) => {
      const selectedPriceA = a.prices.find((p) => p.type === selectedFuelType);
      const selectedPriceB = b.prices.find((p) => p.type === selectedFuelType);
      const priceA =
        selectedServiceMode === "self"
          ? selectedPriceA?.selfService ?? 999
          : selectedPriceA?.served ?? 999;
      const priceB =
        selectedServiceMode === "self"
          ? selectedPriceB?.selfService ?? 999
          : selectedPriceB?.served ?? 999;
      return priceA - priceB;
    });

  const favoritesStations = filteredStations.filter((s) => s.isFavorite);

  return (
    <FuelContext.Provider
      value={{
        stations: stationsWithDistance,
        selectedFuelType,
        setSelectedFuelType,
        selectedServiceMode,
        setSelectedServiceMode,
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
        isLoading: false,
        isUsingLiveData: false,
        dataError: null,
        refetch: refreshLocalData,
        cachedAt: dataset.extractionDate,
      }}
    >
      {children}
    </FuelContext.Provider>
  );
}
