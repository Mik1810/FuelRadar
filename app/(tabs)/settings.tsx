import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DataStatusBanner } from "@/components/DataStatusBanner";
import { useFuel } from "@/context/FuelContext";
import { useColors } from "@/hooks/useColors";

const RADIUS_MIN = 5;
const RADIUS_MAX = 50;
const RADIUS_STEP = 5;

function formatDate(value: string | null): string {
  if (!value) return "Non disponibile";

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;

  return value;
}

function nearestRadius(value: number): number {
  const stepped = Math.round(value / RADIUS_STEP) * RADIUS_STEP;
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, stepped));
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    stations,
    radiusKm,
    setRadiusKm,
    cachedAt,
    isLoading,
    refetch,
  } = useFuel();
  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const priceCount = stations.reduce((total, station) => {
    return total + station.prices.reduce((sum, price) => {
      return sum + 1 + (price.served !== undefined ? 1 : 0);
    }, 0);
  }, 0);
  const canDecreaseRadius = radiusKm > RADIUS_MIN;
  const canIncreaseRadius = radiusKm < RADIUS_MAX;
  const updateRadius = (delta: number) => {
    setRadiusKm(nearestRadius(radiusKm + delta));
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPadding + 18, paddingBottom: insets.bottom + 110 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          Impostazioni
        </Text>

        <View style={[styles.section, { borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="navigate-outline" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              Raggio ricerca
            </Text>
          </View>
          <Text style={[styles.valueText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
            {radiusKm} km
          </Text>
          <View style={styles.radiusControls}>
            <TouchableOpacity
              style={[
                styles.radiusButton,
                { borderColor: colors.border, opacity: canDecreaseRadius ? 1 : 0.45 },
              ]}
              onPress={() => updateRadius(-RADIUS_STEP)}
              disabled={!canDecreaseRadius}
              activeOpacity={0.8}
            >
              <Ionicons name="remove" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <View style={[styles.radiusValue, { borderColor: colors.border }]}>
              <Text
                style={[
                  styles.radiusValueText,
                  { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                {radiusKm}
              </Text>
            </View>
            <TouchableOpacity
              style={[
                styles.radiusButton,
                { borderColor: colors.border, opacity: canIncreaseRadius ? 1 : 0.45 },
              ]}
              onPress={() => updateRadius(RADIUS_STEP)}
              disabled={!canIncreaseRadius}
              activeOpacity={0.8}
            >
              <Ionicons name="add" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            Minimo 5 km, massimo 50 km
          </Text>
        </View>

        <View style={[styles.section, { borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="server-outline" size={20} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              Dati locali
            </Text>
          </View>
          <DataStatusBanner />
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                {stations.length}
              </Text>
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                stazioni
              </Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                {priceCount}
              </Text>
              <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                prezzi
              </Text>
            </View>
          </View>
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            Dataset aggiornato al {formatDate(cachedAt)}
          </Text>
          <TouchableOpacity
            style={[styles.refreshButton, { backgroundColor: colors.primary }]}
            onPress={refetch}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh-outline" size={18} color="#FFFFFF" />
            <Text style={[styles.refreshText, { fontFamily: "Inter_600SemiBold" }]}>
              {isLoading ? "Aggiornamento..." : "Aggiorna dati"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    gap: 16,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 30,
  },
  section: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 14,
    padding: 16,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
  },
  valueText: {
    fontSize: 28,
  },
  radiusControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  radiusButton: {
    width: 48,
    height: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  radiusValue: {
    minWidth: 86,
    height: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  radiusValueText: {
    fontSize: 18,
  },
  statsRow: {
    flexDirection: "row",
    gap: 12,
  },
  stat: {
    flex: 1,
  },
  statValue: {
    fontSize: 24,
  },
  metaText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  refreshButton: {
    alignItems: "center",
    borderRadius: 10,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    paddingVertical: 12,
  },
  refreshText: {
    color: "#FFFFFF",
    fontSize: 15,
  },
});
