import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { MapStationMarker } from "@/components/MapStationMarker";
import { FuelType, GasStation } from "@/context/FuelContext";

interface NativeMapProps {
  mapRef: React.RefObject<MapView | null>;
  stations: GasStation[];
  selectedFuelType: FuelType;
  selectedStation: GasStation | null;
  onSelectStation: (station: GasStation) => void;
  userLocation: { latitude: number; longitude: number } | null;
  isDark: boolean;
}

const ROME_REGION = {
  latitude: 41.9028,
  longitude: 12.4964,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

export function NativeMap({
  mapRef,
  stations,
  selectedFuelType,
  selectedStation,
  onSelectStation,
  userLocation,
  isDark,
}: NativeMapProps) {
  const stationsWithPrice = stations.filter((s) =>
    s.prices.some((p) => p.type === selectedFuelType)
  );

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={ROME_REGION}
      showsUserLocation={!!userLocation}
      showsMyLocationButton={false}
      userInterfaceStyle={isDark ? "dark" : "light"}
    >
      {stationsWithPrice.map((station) => (
        <Marker
          key={station.id}
          coordinate={{
            latitude: station.latitude,
            longitude: station.longitude,
          }}
          onPress={() => onSelectStation(station)}
          tracksViewChanges={false}
        >
          <MapStationMarker
            station={station}
            selectedFuelType={selectedFuelType}
            isSelected={selectedStation?.id === station.id}
            onPress={() => onSelectStation(station)}
          />
        </Marker>
      ))}
    </MapView>
  );
}
