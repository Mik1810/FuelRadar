import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  FUEL_COLORS,
  FUEL_LABELS,
  FuelType,
  GasStation,
  useFuel,
} from "@/context/FuelContext";
import { useColors } from "@/hooks/useColors";

interface StationCardProps {
  station: GasStation;
  rank?: number;
  isFirst?: boolean;
}

const BRAND_COLORS: Record<string, string> = {
  Eni: "#FFD700",
  IP: "#1A56C2",
  Q8: "#E4002B",
  Shell: "#DD1D21",
  Tamoil: "#E63329",
  Esso: "#003087",
  TotalEnergies: "#EF3925",
};

function getBrandColor(brand: string): string {
  return BRAND_COLORS[brand] ?? "#6B7280";
}

function getBrandInitials(brand: string): string {
  return brand.substring(0, 2).toUpperCase();
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

export function StationCard({ station, rank, isFirst }: StationCardProps) {
  const colors = useColors();
  const { selectedFuelType, selectedServiceMode, toggleFavorite } = useFuel();

  const price = station.prices.find((p) => p.type === selectedFuelType);
  const displayPrice =
    selectedServiceMode === "self" ? price?.selfService : price?.served;
  const fuelColor = FUEL_COLORS[selectedFuelType];

  const handleFavorite = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleFavorite(station.id);
  };

  const otherFuels = station.prices
    .filter((p) => p.type !== selectedFuelType)
    .slice(0, 2);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: isFirst ? fuelColor : colors.border,
          borderWidth: isFirst ? 1.5 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      {isFirst && (
        <View style={[styles.cheapestBadge, { backgroundColor: fuelColor }]}>
          <Text style={styles.cheapestText}>Più conveniente</Text>
        </View>
      )}

      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View
            style={[
              styles.brandBadge,
              { backgroundColor: getBrandColor(station.brand) + "22" },
            ]}
          >
            <Text
              style={[
                styles.brandInitials,
                { color: getBrandColor(station.brand) },
              ]}
            >
              {getBrandInitials(station.brand)}
            </Text>
          </View>
          <View style={styles.nameBlock}>
            <Text
              style={[
                styles.stationName,
                { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
              ]}
              numberOfLines={1}
            >
              {station.name}
            </Text>
            <Text
              style={[
                styles.address,
                { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
              ]}
              numberOfLines={1}
            >
              {station.address}, {station.city}
            </Text>
          </View>
        </View>

        <TouchableOpacity onPress={handleFavorite} hitSlop={12} style={styles.favoriteBtn}>
          <Ionicons
            name={station.isFavorite ? "heart" : "heart-outline"}
            size={22}
            color={station.isFavorite ? "#EF4444" : colors.mutedForeground}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <View style={styles.leftSection}>
          {station.distance !== undefined && (
            <View style={styles.distanceRow}>
              <Ionicons
                name="location-outline"
                size={12}
                color={colors.mutedForeground}
              />
              <Text
                style={[
                  styles.distance,
                  { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                ]}
              >
                {formatDistance(station.distance)}
              </Text>
            </View>
          )}
          <View style={styles.otherFuels}>
            {otherFuels.map((p) => (
              <View
                key={p.type}
                style={[
                  styles.fuelChip,
                  { backgroundColor: FUEL_COLORS[p.type as FuelType] + "22" },
                ]}
              >
                <Text
                  style={[
                    styles.fuelChipText,
                    { color: FUEL_COLORS[p.type as FuelType], fontFamily: "Inter_500Medium" },
                  ]}
                >
                  {FUEL_LABELS[p.type as FuelType]} {p.selfService.toFixed(3)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.priceBlock}>
          {rank !== undefined && (
            <Text
              style={[
                styles.rank,
                { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
              ]}
            >
              #{rank}
            </Text>
          )}
          {displayPrice && (
            <Text
              style={[
                styles.price,
                { color: fuelColor, fontFamily: "Inter_700Bold" },
              ]}
            >
              {displayPrice.toFixed(3)}
            </Text>
          )}
          <Text
            style={[
              styles.priceUnit,
              { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
            ]}
          >
            €/L{selectedFuelType === "metano" ? " (kg)" : ""}
          </Text>
        </View>
      </View>

      <Text
        style={[
          styles.updated,
          { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
        ]}
      >
        Aggiornato alle {formatTime(station.lastUpdated)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 16,
    padding: 16,
    overflow: "hidden",
  },
  cheapestBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    borderBottomLeftRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  cheapestText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  brandBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  brandInitials: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  nameBlock: {
    flex: 1,
  },
  stationName: {
    fontSize: 15,
    marginBottom: 2,
  },
  address: {
    fontSize: 13,
  },
  favoriteBtn: {
    padding: 4,
  },
  footer: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  leftSection: {
    flex: 1,
    marginRight: 12,
  },
  distanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 8,
  },
  distance: {
    fontSize: 12,
  },
  otherFuels: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  fuelChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
  },
  fuelChipText: {
    fontSize: 11,
  },
  priceBlock: {
    alignItems: "flex-end",
  },
  rank: {
    fontSize: 12,
    marginBottom: 2,
  },
  price: {
    fontSize: 28,
    lineHeight: 32,
  },
  priceUnit: {
    fontSize: 11,
  },
  updated: {
    fontSize: 11,
    marginTop: 4,
  },
});
