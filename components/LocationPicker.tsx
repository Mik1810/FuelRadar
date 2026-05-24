import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SavedLocation, useFuel } from "@/context/FuelContext";
import { useColors } from "@/hooks/useColors";

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
  };
}

function getShortName(result: NominatimResult): string {
  const addr = result.address;
  if (!addr) return result.display_name.split(",")[0];
  return (
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    result.display_name.split(",")[0]
  );
}

export function LocationPicker() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    savedLocations,
    selectedLocation,
    setSelectedLocation,
    addSavedLocation,
    removeSavedLocation,
    userLocation,
  } = useFuel();

  const [modalVisible, setModalVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentLabel = selectedLocation
    ? selectedLocation.name
    : userLocation
    ? "Posizione attuale"
    : "Seleziona zona";

  const searchLocations = useCallback((text: string) => {
    setQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          text
        )}&format=json&countrycodes=it&limit=6&addressdetails=1`;
        const res = await fetch(url, {
          headers: { "Accept-Language": "it" },
        });
        const data: NominatimResult[] = await res.json();
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  const handleSelectResult = async (result: NominatimResult) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const name = getShortName(result);
    addSavedLocation({
      name,
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
    });
    setModalVisible(false);
    setQuery("");
    setResults([]);
  };

  const handleSelectSaved = async (loc: SavedLocation) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedLocation(loc);
    setModalVisible(false);
    setQuery("");
    setResults([]);
  };

  const handleUseGPS = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedLocation(null);
    setModalVisible(false);
    setQuery("");
    setResults([]);
  };

  const handleRemove = async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    removeSavedLocation(id);
  };

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <>
      <TouchableOpacity
        onPress={() => setModalVisible(true)}
        style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}
        activeOpacity={0.75}
      >
        <Ionicons name="location" size={14} color={colors.primary} />
        <Text
          style={[
            styles.pillText,
            { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
          ]}
          numberOfLines={1}
        >
          {currentLabel}
        </Text>
        <Ionicons name="chevron-down" size={14} color={colors.mutedForeground} />
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, paddingBottom: bottomPad + 8 },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <Text
            style={[
              styles.sheetTitle,
              { color: colors.foreground, fontFamily: "Inter_700Bold" },
            ]}
          >
            Scegli zona
          </Text>

          <View
            style={[
              styles.searchBox,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <Ionicons name="search-outline" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[
                styles.searchInput,
                { color: colors.foreground, fontFamily: "Inter_400Regular" },
              ]}
              placeholder="Cerca città o comune..."
              placeholderTextColor={colors.mutedForeground}
              value={query}
              onChangeText={searchLocations}
              autoFocus
              returnKeyType="search"
            />
            {searching && (
              <ActivityIndicator size="small" color={colors.primary} />
            )}
            {query.length > 0 && !searching && (
              <TouchableOpacity
                onPress={() => {
                  setQuery("");
                  setResults([]);
                }}
                hitSlop={8}
              >
                <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          {results.length > 0 && (
            <FlatList
              data={results}
              keyExtractor={(item) => item.place_id.toString()}
              style={styles.resultsList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.resultRow, { borderBottomColor: colors.border }]}
                  onPress={() => handleSelectResult(item)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="location-outline"
                    size={16}
                    color={colors.primary}
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.resultName,
                        { color: colors.foreground, fontFamily: "Inter_500Medium" },
                      ]}
                      numberOfLines={1}
                    >
                      {getShortName(item)}
                    </Text>
                    <Text
                      style={[
                        styles.resultDetail,
                        { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                      ]}
                      numberOfLines={1}
                    >
                      {item.display_name.split(",").slice(1, 3).join(",").trim()}
                    </Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
                </TouchableOpacity>
              )}
            />
          )}

          {results.length === 0 && (
            <>
              <TouchableOpacity
                style={[styles.optionRow, { borderBottomColor: colors.border }]}
                onPress={handleUseGPS}
                activeOpacity={0.7}
              >
                <View
                  style={[styles.optionIcon, { backgroundColor: colors.primary + "22" }]}
                >
                  <Ionicons name="navigate" size={18} color={colors.primary} />
                </View>
                <Text
                  style={[
                    styles.optionText,
                    { color: colors.foreground, fontFamily: "Inter_500Medium" },
                  ]}
                >
                  Usa posizione GPS
                </Text>
                {!selectedLocation && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>

              {savedLocations.length > 0 && (
                <>
                  <Text
                    style={[
                      styles.sectionLabel,
                      { color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
                    ]}
                  >
                    Zone salvate
                  </Text>
                  {savedLocations.map((loc) => (
                    <TouchableOpacity
                      key={loc.id}
                      style={[styles.optionRow, { borderBottomColor: colors.border }]}
                      onPress={() => handleSelectSaved(loc)}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.optionIcon,
                          { backgroundColor: colors.secondary },
                        ]}
                      >
                        <Ionicons name="bookmark" size={18} color={colors.foreground} />
                      </View>
                      <Text
                        style={[
                          styles.optionText,
                          { color: colors.foreground, fontFamily: "Inter_500Medium" },
                        ]}
                        numberOfLines={1}
                      >
                        {loc.name}
                      </Text>
                      <View style={styles.optionActions}>
                        {selectedLocation?.id === loc.id && (
                          <Ionicons
                            name="checkmark-circle"
                            size={20}
                            color={colors.primary}
                          />
                        )}
                        <TouchableOpacity
                          onPress={() => handleRemove(loc.id)}
                          hitSlop={8}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={18}
                            color={colors.mutedForeground}
                          />
                        </TouchableOpacity>
                      </View>
                    </TouchableOpacity>
                  ))}
                </>
              )}

              {savedLocations.length === 0 && query.length === 0 && (
                <View style={styles.hint}>
                  <Ionicons
                    name="search-outline"
                    size={36}
                    color={colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.hintText,
                      { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                    ]}
                  >
                    Cerca una città o un comune per salvarlo come zona preferita
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
    alignSelf: "flex-start",
    maxWidth: 220,
  },
  pillText: {
    fontSize: 14,
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingTop: 12,
    maxHeight: "80%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 20,
    marginBottom: 16,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  resultsList: {
    maxHeight: 300,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultName: {
    fontSize: 15,
  },
  resultDetail: {
    fontSize: 12,
    marginTop: 2,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    fontSize: 15,
    flex: 1,
  },
  optionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionLabel: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 4,
  },
  hint: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 12,
    paddingHorizontal: 24,
  },
  hintText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
