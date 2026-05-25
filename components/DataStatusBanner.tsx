import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFuel } from "@/context/FuelContext";
import { useColors } from "@/hooks/useColors";

function formatCachedAt(iso: string): string {
  try {
    const dateOnlyMatch = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      return `${day}/${month}/${year}`;
    }

    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function DataStatusBanner() {
  const colors = useColors();
  const { isLoading, isUsingLiveData, dataError, cachedAt, refetch } = useFuel();

  if (isLoading) {
    return (
      <View style={[styles.banner, { backgroundColor: colors.secondary }]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.text, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          Caricamento dati...
        </Text>
      </View>
    );
  }

  if (dataError) {
    return (
      <View style={[styles.banner, { backgroundColor: "#FEF3C7" }]}>
        <Ionicons name="warning-outline" size={14} color="#D97706" />
        <Text style={[styles.text, { color: "#92400E", fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
          {dataError}
        </Text>
        <TouchableOpacity onPress={refetch} hitSlop={8}>
          <Ionicons name="refresh-outline" size={16} color="#D97706" />
        </TouchableOpacity>
      </View>
    );
  }

  if (cachedAt) {
    return (
      <View style={[styles.banner, { backgroundColor: isUsingLiveData ? "#DCFCE7" : colors.secondary }]}>
        <Ionicons
          name={isUsingLiveData ? "checkmark-circle" : "information-circle-outline"}
          size={14}
          color={isUsingLiveData ? "#16A34A" : colors.mutedForeground}
        />
        <Text
          style={[
            styles.text,
            {
              color: isUsingLiveData ? "#14532D" : colors.mutedForeground,
              fontFamily: "Inter_400Regular",
            },
          ]}
          numberOfLines={1}
        >
          Dati locali SQLite, aggiornati al {formatCachedAt(cachedAt)}
        </Text>
        <TouchableOpacity onPress={refetch} hitSlop={8}>
          <Ionicons
            name="refresh-outline"
            size={16}
            color={isUsingLiveData ? "#16A34A" : colors.mutedForeground}
          />
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  text: {
    fontSize: 12,
    flex: 1,
  },
});
