import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { FUEL_COLORS, FUEL_LABELS, FuelType, useFuel } from "@/context/FuelContext";
import { useColors } from "@/hooks/useColors";

const FUEL_TYPES: FuelType[] = ["benzina", "diesel", "metano", "gpl"];

export function FilterBar() {
  const {
    selectedFuelType,
    selectedServiceMode,
    setSelectedFuelType,
    setSelectedServiceMode,
  } = useFuel();
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {FUEL_TYPES.map((type) => {
          const isSelected = selectedFuelType === type;
          const fuelColor = FUEL_COLORS[type];
          return (
            <TouchableOpacity
              key={type}
              onPress={() => setSelectedFuelType(type)}
              style={[
                styles.chip,
                {
                  backgroundColor: isSelected ? fuelColor : colors.card,
                  borderColor: isSelected ? fuelColor : colors.border,
                },
              ]}
              activeOpacity={0.75}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color: isSelected ? "#FFFFFF" : colors.mutedForeground,
                    fontFamily: isSelected
                      ? "Inter_600SemiBold"
                      : "Inter_400Regular",
                  },
                ]}
              >
                {FUEL_LABELS[type]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <View style={[styles.serviceToggle, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => setSelectedServiceMode("self")}
          style={[
            styles.serviceButton,
            selectedServiceMode === "self" && { backgroundColor: colors.primary },
          ]}
          activeOpacity={0.75}
        >
          <Text
            style={[
              styles.serviceText,
              {
                color:
                  selectedServiceMode === "self"
                    ? "#FFFFFF"
                    : colors.mutedForeground,
                fontFamily:
                  selectedServiceMode === "self"
                    ? "Inter_600SemiBold"
                    : "Inter_400Regular",
              },
            ]}
          >
            Self
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setSelectedServiceMode("served")}
          style={[
            styles.serviceButton,
            selectedServiceMode === "served" && { backgroundColor: colors.primary },
          ]}
          activeOpacity={0.75}
        >
          <Text
            style={[
              styles.serviceText,
              {
                color:
                  selectedServiceMode === "served"
                    ? "#FFFFFF"
                    : colors.mutedForeground,
                fontFamily:
                  selectedServiceMode === "served"
                    ? "Inter_600SemiBold"
                    : "Inter_400Regular",
              },
            ]}
          >
            Servito
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
  },
  serviceToggle: {
    alignSelf: "flex-start",
    borderRadius: 100,
    borderWidth: 1,
    flexDirection: "row",
    marginHorizontal: 16,
    padding: 3,
  },
  serviceButton: {
    borderRadius: 100,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  serviceText: {
    fontSize: 13,
  },
});
