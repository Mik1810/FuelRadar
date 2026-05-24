import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { FUEL_COLORS, FuelType, GasStation, useFuel } from "@/context/FuelContext";

interface MapStationMarkerProps {
  station: GasStation;
  selectedFuelType: FuelType;
  isSelected?: boolean;
  onPress: () => void;
}

export function MapStationMarker({
  station,
  selectedFuelType,
  isSelected,
  onPress,
}: MapStationMarkerProps) {
  const { selectedServiceMode } = useFuel();
  const price = station.prices.find((p) => p.type === selectedFuelType);
  const fuelColor = FUEL_COLORS[selectedFuelType];
  const displayPrice =
    selectedServiceMode === "self" ? price?.selfService : price?.served;

  if (!price || !displayPrice) return null;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <View
        style={[
          styles.markerContainer,
          {
            backgroundColor: isSelected ? fuelColor : "#1A1A27",
            borderColor: fuelColor,
            transform: [{ scale: isSelected ? 1.1 : 1 }],
          },
        ]}
      >
        <Text
          style={[
            styles.priceText,
            {
              color: isSelected ? "#FFFFFF" : fuelColor,
              fontFamily: "Inter_700Bold",
            },
          ]}
        >
          {displayPrice.toFixed(3)}
        </Text>
      </View>
      <View style={[styles.arrow, { borderTopColor: fuelColor }]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  markerContainer: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 64,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  priceText: {
    fontSize: 13,
  },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    alignSelf: "center",
    marginTop: -1,
  },
});
