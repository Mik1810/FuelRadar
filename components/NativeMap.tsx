import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { FuelType, GasStation } from "@/context/FuelContext";
import { useColors } from "@/hooks/useColors";

interface NativeMapProps {
  mapRef: React.RefObject<any>;
  stations: GasStation[];
  selectedFuelType: FuelType;
  selectedStation: GasStation | null;
  onSelectStation: (station: GasStation) => void;
  onVisibleCenterChange: (center: { latitude: number; longitude: number }) => void;
  userLocation: { latitude: number; longitude: number } | null;
  isDark: boolean;
}

export function NativeMap({ stations, selectedFuelType, onSelectStation }: NativeMapProps) {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Ionicons name="map-outline" size={56} color={colors.mutedForeground} />
      <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
        La mappa è disponibile su iOS e Android
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        Usa la scheda Lista per trovare i distributori più economici vicino a te
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 14,
  },
  title: {
    fontSize: 18,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
  },
});
