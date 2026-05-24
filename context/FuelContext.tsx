import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { MOCK_STATIONS } from "@/data/mockStations";

export type FuelType = "benzina" | "diesel" | "metano" | "gpl";

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

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN;
const API_BASE = DOMAIN ? `https://${DOMAIN}` : "";

async function fetchNearbyStations(
  lat: number,
  lng: number,
  radius: number
): Promise<{ stations: GasStation[]; cachedAt: string } | null> {
  try {
    const url = `${API_BASE}/api/stations/nearby?lat=${lat}&lng=${lng}&radius=${radius}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      stations: data.stations.map((s: any) => ({
        id: s.id,
        name: s.name,
        brand: s.brand,
        address: s.address,
        city: s.city,
        latitude: s.latitude,
        longitude: s.longitude,
        prices: s.prices.map((p: any) => ({
          type: p.type as FuelType,
          selfService: p.selfService,
          served: p.served ?? undefined,
        })),
        isFavorite: false,
        lastUpdated: s.lastUpdated,
        distance: s.distance,
      })),
      cachedAt: data.cachedAt,
    };
  } catch {
    return null;
  }
}

function mergeFavorites(
  stations: GasStation[],
  favorites: Set<string>
): GasStation[] {
  return stations.map((s) => ({ ...s, isFavorite: favorites.has(s.id) }));
}

export function FuelProvider({ children }: { children: React.ReactNode }) {
  const [rawStations, setRawStations] = useState<GasStation[]>(MOCK_STATIONS);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [selectedFuelType, setSelectedFuelType] = useState<FuelType>("benzina");
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<SavedLocation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUsingLiveData, setIsUsingLiveData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const fetchRef = useRef(0);

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

  const loadLiveData = useCallback(async () => {
    if (!mapCenter) return;
    const token = ++fetchRef.current;
    setIsLoading(true);
    setDataError(null);
    const result = await fetchNearbyStations(
      mapCenter.latitude,
      mapCenter.longitude,
      RADIUS_KM
    );
    if (token !== fetchRef.current) return;
    if (result && result.stations.length > 0) {
      setRawStations(result.stations);
      setIsUsingLiveData(true);
      setCachedAt(result.cachedAt);
      setDataError(null);
    } else {
      setDataError("Dati live non disponibili, uso dati di esempio");
      setIsUsingLiveData(false);
    }
    setIsLoading(false);
  }, [mapCenter?.latitude, mapCenter?.longitude]);

  useEffect(() => {
    loadLiveData();
  }, [loadLiveData]);

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

  const stations = mergeFavorites(rawStations, favorites);

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
    .filter((s) => s.prices.some((p) => p.type === selectedFuelType))
    .sort((a, b) => {
      const priceA =
        a.prices.find((p) => p.type === selectedFuelType)?.selfService ?? 999;
      const priceB =
        b.prices.find((p) => p.type === selectedFuelType)?.selfService ?? 999;
      return priceA - priceB;
    });

  const favoritesStations = filteredStations.filter((s) => s.isFavorite);

  return (
    <FuelContext.Provider
      value={{
        stations: stationsWithDistance,
        selectedFuelType,
        setSelectedFuelType,
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
        isLoading,
        isUsingLiveData,
        dataError,
        refetch: loadLiveData,
        cachedAt,
      }}
    >
      {children}
    </FuelContext.Provider>
  );
}
