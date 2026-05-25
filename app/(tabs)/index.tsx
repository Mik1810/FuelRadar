import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeMap } from "@/components/NativeMap";
import { StationDetailSheet } from "@/components/StationDetailSheet";
import { FilterBar } from "@/components/FilterBar";
import { LocationPicker } from "@/components/LocationPicker";
import { GasStation, useFuel } from "@/context/FuelContext";
import { useColors } from "@/hooks/useColors";

const FOCUSED_STATION_LATITUDE_DELTA = 0.022;
const FOCUSED_STATION_LONGITUDE_DELTA = 0.022;

function getFocusedStationRegion(station: GasStation) {
  return {
    latitude: station.latitude - FOCUSED_STATION_LATITUDE_DELTA * 0.28,
    longitude: station.longitude,
    latitudeDelta: FOCUSED_STATION_LATITUDE_DELTA,
    longitudeDelta: FOCUSED_STATION_LONGITUDE_DELTA,
  };
}

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const mapRef = useRef<any>(null);
  const isFocused = useIsFocused();

  const {
    stations,
    selectedFuelType,
    userLocation,
    setUserLocation,
    selectedLocation,
    setSelectedLocation,
    mapCenter,
    setVisibleMapCenter,
    focusedStationId,
    setFocusedStationId,
  } = useFuel();
  const [selectedStation, setSelectedStation] = useState<GasStation | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [topBarHeight, setTopBarHeight] = useState(0);

  useEffect(() => {
    if (isFocused && mapCenter && mapRef.current) {
      mapRef.current?.animateToRegion({
        latitude: mapCenter.latitude,
        longitude: mapCenter.longitude,
        latitudeDelta: 0.12,
        longitudeDelta: 0.12,
      });
    }
  }, [isFocused, mapCenter]);

  useEffect(() => {
    if (!isFocused || !focusedStationId) return;

    const station = stations.find((item) => item.id === focusedStationId);
    if (!station) return;

    const region = getFocusedStationRegion(station);
    setSelectedStation(station);
    mapRef.current?.animateToRegion(region);
    setVisibleMapCenter({
      latitude: region.latitude,
      longitude: region.longitude,
    });
    setFocusedStationId(null);
  }, [focusedStationId, isFocused, setFocusedStationId, setVisibleMapCenter, stations]);

  useEffect(() => {
    if (!selectedStation) return;

    const updatedStation = stations.find((item) => item.id === selectedStation.id);
    if (updatedStation && updatedStation.isFavorite !== selectedStation.isFavorite) {
      setSelectedStation(updatedStation);
    }
  }, [selectedStation, stations]);

  const requestLocation = async () => {
    setLocationLoading(true);
    try {
      if (Platform.OS === "web") {
        if (typeof navigator !== "undefined" && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const loc = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              };
              setUserLocation(loc);
              setSelectedLocation(null);
              setSelectedStation(null);
              setVisibleMapCenter(loc);
              mapRef.current?.animateToRegion({
                ...loc,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              });
              setLocationLoading(false);
            },
            () => {
              setLocationDenied(true);
              setLocationLoading(false);
            }
          );
        } else {
          setLocationLoading(false);
        }
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setLocationDenied(true);
          setLocationLoading(false);
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const position = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setUserLocation(position);
        setSelectedLocation(null);
        setSelectedStation(null);
        setVisibleMapCenter(position);
        mapRef.current?.animateToRegion({
          ...position,
          latitudeDelta: 0.07,
          longitudeDelta: 0.07,
        });
        setLocationLoading(false);
      }
    } catch {
      setLocationLoading(false);
    }
  };

  const centerOnUser = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (userLocation) {
      setSelectedLocation(null);
      setSelectedStation(null);
      setVisibleMapCenter(userLocation);
      mapRef.current?.animateToRegion({
        ...userLocation,
        latitudeDelta: 0.07,
        longitudeDelta: 0.07,
      });
    } else {
      requestLocation();
    }
  };

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={styles.container}>
      <View style={[styles.mapLayer, topBarHeight > 0 && { top: topBarHeight }]}>
        <NativeMap
          mapRef={mapRef}
          stations={stations}
          selectedFuelType={selectedFuelType}
          selectedStation={selectedStation}
          onSelectStation={setSelectedStation}
          onVisibleCenterChange={setVisibleMapCenter}
          userLocation={userLocation}
          isDark={isDark}
        />
      </View>

      <View
        onLayout={(event) => setTopBarHeight(event.nativeEvent.layout.height)}
        style={[
          styles.topBar,
          {
            paddingTop: topInset + 8,
            backgroundColor: colors.background + "F0",
          },
        ]}
      >
        <View style={styles.locationRow}>
          <LocationPicker />
        </View>
        <FilterBar />
      </View>

      {Platform.OS !== "web" && (
        <View style={[styles.floatingButtons, { bottom: insets.bottom + 100 }]}>
          {locationDenied && (
            <View
              style={[
                styles.deniedBanner,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text
                style={[
                  styles.deniedText,
                  {
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                  },
                ]}
              >
                Posizione non disponibile
              </Text>
            </View>
          )}
          <TouchableOpacity
            onPress={centerOnUser}
            style={[
              styles.locationBtn,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            activeOpacity={0.8}
          >
            {locationLoading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons
                name={userLocation && !selectedLocation ? "locate" : "locate-outline"}
                size={22}
                color={
                  userLocation && !selectedLocation
                    ? colors.primary
                    : colors.foreground
                }
              />
            )}
          </TouchableOpacity>
        </View>
      )}

      <StationDetailSheet
        station={selectedStation}
        onClose={() => setSelectedStation(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 10,
  },
  locationRow: {
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  floatingButtons: {
    position: "absolute",
    right: 16,
    alignItems: "flex-end",
    gap: 10,
  },
  locationBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  deniedBanner: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  deniedText: {
    fontSize: 12,
  },
});
