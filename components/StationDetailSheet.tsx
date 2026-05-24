import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FUEL_COLORS,
  FUEL_LABELS,
  GasStation,
  useFuel,
} from "@/context/FuelContext";
import { useColors } from "@/hooks/useColors";

interface StationDetailSheetProps {
  station: GasStation | null;
  onClose: () => void;
}

function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export function StationDetailSheet({
  station,
  onClose,
}: StationDetailSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { toggleFavorite } = useFuel();

  if (!station) return null;

  const handleFavorite = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleFavorite(station.id);
  };

  return (
    <Modal
      visible={!!station}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 16,
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        <View style={styles.sheetHeader}>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.sheetName,
                { color: colors.foreground, fontFamily: "Inter_700Bold" },
              ]}
            >
              {station.name}
            </Text>
            <View style={styles.sheetAddressRow}>
              <Ionicons
                name="location-outline"
                size={13}
                color={colors.mutedForeground}
              />
              <Text
                style={[
                  styles.sheetAddress,
                  { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                ]}
              >
                {station.address}, {station.city}
                {station.distance !== undefined
                  ? ` · ${formatDistance(station.distance)}`
                  : ""}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={handleFavorite} hitSlop={10}>
            <Ionicons
              name={station.isFavorite ? "heart" : "heart-outline"}
              size={26}
              color={station.isFavorite ? "#EF4444" : colors.mutedForeground}
            />
          </TouchableOpacity>
        </View>

        <Text
          style={[
            styles.pricesTitle,
            { color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
          ]}
        >
          Prezzi carburante
        </Text>

        <ScrollView showsVerticalScrollIndicator={false}>
          {station.prices.map((price) => (
            <View
              key={price.type}
              style={[styles.priceRow, { borderBottomColor: colors.border }]}
            >
              <View style={styles.priceLeft}>
                <View
                  style={[
                    styles.fuelDot,
                    { backgroundColor: FUEL_COLORS[price.type] },
                  ]}
                />
                <Text
                  style={[
                    styles.fuelLabel,
                    { color: colors.foreground, fontFamily: "Inter_500Medium" },
                  ]}
                >
                  {FUEL_LABELS[price.type]}
                </Text>
              </View>
              <View style={styles.priceRight}>
                <View style={styles.priceItem}>
                  <Text
                    style={[
                      styles.priceLabel,
                      { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                    ]}
                  >
                    Self
                  </Text>
                  <Text
                    style={[
                      styles.priceValue,
                      {
                        color: FUEL_COLORS[price.type],
                        fontFamily: "Inter_700Bold",
                      },
                    ]}
                  >
                    {price.selfService.toFixed(3)}
                  </Text>
                </View>
                {price.served && (
                  <View style={styles.priceItem}>
                    <Text
                      style={[
                        styles.priceLabel,
                        { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                      ]}
                    >
                      Servito
                    </Text>
                    <Text
                      style={[
                        styles.priceValue,
                        {
                          color: colors.foreground,
                          fontFamily: "Inter_600SemiBold",
                        },
                      ]}
                    >
                      {price.served.toFixed(3)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        <TouchableOpacity
          style={[styles.closeBtn, { backgroundColor: colors.secondary }]}
          onPress={onClose}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.closeBtnText,
              { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            Chiudi
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingTop: 12,
    maxHeight: "70%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  sheetName: {
    fontSize: 20,
    marginBottom: 4,
  },
  sheetAddressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sheetAddress: {
    fontSize: 13,
    flex: 1,
  },
  pricesTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
  },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  priceLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  fuelDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  fuelLabel: {
    fontSize: 15,
  },
  priceRight: {
    flexDirection: "row",
    gap: 20,
  },
  priceItem: {
    alignItems: "flex-end",
  },
  priceLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  priceValue: {
    fontSize: 18,
  },
  closeBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  closeBtnText: {
    fontSize: 16,
  },
});
