import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFuel } from "@/context/FuelContext";
import { useColors } from "@/hooks/useColors";

function formatCachedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
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
          Caricamento dati MIMIT...
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

  if (isUsingLiveData && cachedAt) {
    return (
      <View style={[styles.banner, { backgroundColor: "#DCFCE7" }]}>
        <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
        <Text style={[styles.text, { color: "#14532D", fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
          Dati MIMIT aggiornati al {formatCachedAt(cachedAt)}
        </Text>
        <TouchableOpacity onPress={refetch} hitSlop={8}>
          <Ionicons name="refresh-outline" size={16} color="#16A34A" />
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
