import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DataStatusBanner } from "@/components/DataStatusBanner";
import { FilterBar } from "@/components/FilterBar";
import { LocationPicker } from "@/components/LocationPicker";
import { StationCard } from "@/components/StationCard";
import { GasStation, useFuel } from "@/context/FuelContext";
import { useColors } from "@/hooks/useColors";

export default function ListScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { filteredStations, setFocusedStationId, setVisibleMapCenter } = useFuel();
  const [refreshing, setRefreshing] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  };

  const openStationOnMap = (station: GasStation) => {
    setVisibleMapCenter({
      latitude: station.latitude,
      longitude: station.longitude,
    });
    setFocusedStationId(station.id);
    router.navigate("/");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPadding + 10,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.locationRow}>
          <LocationPicker />
        </View>
        <FilterBar />
        <DataStatusBanner />
      </View>

      <FlatList
        data={filteredStations}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <StationCard
            station={item}
            rank={index + 1}
            isFirst={index === 0}
            onPress={openStationOnMap}
          />
        )}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + 90 },
        ]}
        scrollEnabled={!!filteredStations.length}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons
              name="filter-outline"
              size={48}
              color={colors.mutedForeground}
            />
            <Text
              style={[
                styles.emptyTitle,
                { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              Nessuna stazione trovata
            </Text>
            <Text
              style={[
                styles.emptySubtitle,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
            >
              Prova a cambiare zona o tipo di carburante
            </Text>
          </View>
        }
        ListHeaderComponent={
          filteredStations.length > 0 ? (
            <Text
              style={[
                styles.resultCount,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
            >
              {filteredStations.length} distributori trovati
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 4,
  },
  locationRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  list: {
    paddingTop: 8,
  },
  resultCount: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
