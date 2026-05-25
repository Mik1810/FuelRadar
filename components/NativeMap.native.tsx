import React, { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import { MapStationMarker } from "@/components/MapStationMarker";
import { FUEL_COLORS, FuelType, GasStation } from "@/context/FuelContext";

interface NativeMapProps {
  mapRef: React.RefObject<MapView | null>;
  stations: GasStation[];
  selectedFuelType: FuelType;
  selectedStation: GasStation | null;
  onSelectStation: (station: GasStation) => void;
  onVisibleCenterChange: (center: { latitude: number; longitude: number }) => void;
  userLocation: { latitude: number; longitude: number } | null;
  isDark: boolean;
}

const ROME_REGION = {
  latitude: 41.9028,
  longitude: 12.4964,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

const MAX_VISIBLE_MARKERS = 20;
const MAX_CLUSTER_MARKERS = 24;
const MAX_CLUSTER_DEPTH = 10;

type StationCluster = {
  id: string;
  latitude: number;
  longitude: number;
  stations: GasStation[];
};

type ClusterBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

type ClusterBucket = {
  id: string;
  stations: GasStation[];
  bounds: ClusterBounds;
  depth: number;
};

function toSingleStationCluster(station: GasStation): StationCluster {
  return {
    id: station.id,
    latitude: station.latitude,
    longitude: station.longitude,
    stations: [station],
  };
}

function isStationInRegion(station: GasStation, region: Region): boolean {
  const latMin = region.latitude - region.latitudeDelta / 2;
  const latMax = region.latitude + region.latitudeDelta / 2;
  const lonMin = region.longitude - region.longitudeDelta / 2;
  const lonMax = region.longitude + region.longitudeDelta / 2;

  return (
    station.latitude >= latMin &&
    station.latitude <= latMax &&
    station.longitude >= lonMin &&
    station.longitude <= lonMax
  );
}

function regionBounds(region: Region): ClusterBounds {
  return {
    minLat: region.latitude - region.latitudeDelta / 2,
    maxLat: region.latitude + region.latitudeDelta / 2,
    minLon: region.longitude - region.longitudeDelta / 2,
    maxLon: region.longitude + region.longitudeDelta / 2,
  };
}

function splitBucket(bucket: ClusterBucket): ClusterBucket[] {
  const midLat = (bucket.bounds.minLat + bucket.bounds.maxLat) / 2;
  const midLon = (bucket.bounds.minLon + bucket.bounds.maxLon) / 2;
  const childBounds: ClusterBounds[] = [
    { minLat: bucket.bounds.minLat, maxLat: midLat, minLon: bucket.bounds.minLon, maxLon: midLon },
    { minLat: bucket.bounds.minLat, maxLat: midLat, minLon: midLon, maxLon: bucket.bounds.maxLon },
    { minLat: midLat, maxLat: bucket.bounds.maxLat, minLon: bucket.bounds.minLon, maxLon: midLon },
    { minLat: midLat, maxLat: bucket.bounds.maxLat, minLon: midLon, maxLon: bucket.bounds.maxLon },
  ];

  return childBounds
    .map((bounds, index) => ({
      id: `${bucket.id}.${index}`,
      bounds,
      depth: bucket.depth + 1,
      stations: bucket.stations.filter(
        (station) =>
          station.latitude >= bounds.minLat &&
          station.latitude <= bounds.maxLat &&
          station.longitude >= bounds.minLon &&
          station.longitude <= bounds.maxLon
      ),
    }))
    .filter((child) => child.stations.length > 0);
}

function bucketToCluster(bucket: ClusterBucket): StationCluster {
  if (bucket.stations.length === 1) return toSingleStationCluster(bucket.stations[0]);

  const totals = bucket.stations.reduce(
    (acc, station) => ({
      latitude: acc.latitude + station.latitude,
      longitude: acc.longitude + station.longitude,
    }),
    { latitude: 0, longitude: 0 }
  );

  return {
    id: bucket.id,
    latitude: totals.latitude / bucket.stations.length,
    longitude: totals.longitude / bucket.stations.length,
    stations: bucket.stations,
  };
}

function clusterStations(stations: GasStation[], region: Region): StationCluster[] {
  const visibleStations = stations.filter((station) => isStationInRegion(station, region));

  if (visibleStations.length <= MAX_VISIBLE_MARKERS) {
    return visibleStations.map(toSingleStationCluster);
  }

  const buckets: ClusterBucket[] = [
    {
      id: "root",
      stations: visibleStations,
      bounds: regionBounds(region),
      depth: 0,
    },
  ];

  while (buckets.length < MAX_CLUSTER_MARKERS) {
    let splitIndex = -1;
    let largestCount = 1;

    buckets.forEach((bucket, index) => {
      if (bucket.depth >= MAX_CLUSTER_DEPTH) return;
      if (bucket.stations.length > largestCount) {
        largestCount = bucket.stations.length;
        splitIndex = index;
      }
    });

    if (splitIndex === -1) break;

    const [bucket] = buckets.splice(splitIndex, 1);
    const children = splitBucket(bucket);
    if (children.length <= 1 || buckets.length + children.length > MAX_CLUSTER_MARKERS) {
      buckets.splice(splitIndex, 0, bucket);
      break;
    }

    buckets.splice(splitIndex, 0, ...children);
  }

  return buckets.map(bucketToCluster);
}

function getClusterZoomRegion(cluster: StationCluster, region: Region): Region {
  const latitudes = cluster.stations.map((station) => station.latitude);
  const longitudes = cluster.stations.map((station) => station.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes);
  const maxLon = Math.max(...longitudes);
  const clusterLatitudeDelta = Math.max((maxLat - minLat) * 2.4, 0.004);
  const clusterLongitudeDelta = Math.max((maxLon - minLon) * 2.4, 0.004);

  return {
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    latitudeDelta: Math.min(region.latitudeDelta / 3.5, clusterLatitudeDelta),
    longitudeDelta: Math.min(region.longitudeDelta / 3.5, clusterLongitudeDelta),
  };
}

export function NativeMap({
  mapRef,
  stations,
  selectedFuelType,
  selectedStation,
  onSelectStation,
  onVisibleCenterChange,
  userLocation,
  isDark,
}: NativeMapProps) {
  const [region, setRegion] = useState<Region>(ROME_REGION);
  const stationsWithPrice = useMemo(
    () => stations.filter((s) => s.prices.some((p) => p.type === selectedFuelType)),
    [selectedFuelType, stations]
  );
  const selectedStationWithPrice = useMemo(
    () => stationsWithPrice.find((station) => station.id === selectedStation?.id) ?? null,
    [selectedStation?.id, stationsWithPrice]
  );
  const clusterStationsSource = useMemo(
    () =>
      selectedStationWithPrice
        ? stationsWithPrice.filter((station) => station.id !== selectedStationWithPrice.id)
        : stationsWithPrice,
    [selectedStationWithPrice, stationsWithPrice]
  );
  const clusters = useMemo(
    () => clusterStations(clusterStationsSource, region),
    [clusterStationsSource, region]
  );
  const fuelColor = FUEL_COLORS[selectedFuelType];

  const zoomToCluster = (cluster: StationCluster) => {
    const nextRegion = getClusterZoomRegion(cluster, region);
    setRegion(nextRegion);
    onVisibleCenterChange({
      latitude: nextRegion.latitude,
      longitude: nextRegion.longitude,
    });
    mapRef.current?.animateToRegion(nextRegion);
  };

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={ROME_REGION}
      showsUserLocation={!!userLocation}
      showsMyLocationButton={false}
      legalLabelInsets={{ top: 0, right: 0, bottom: 2, left: 2 }}
      userInterfaceStyle={isDark ? "dark" : "light"}
      onMapReady={() => {
        onVisibleCenterChange({
          latitude: ROME_REGION.latitude,
          longitude: ROME_REGION.longitude,
        });
      }}
      onRegionChangeComplete={(region: Region) => {
        setRegion(region);
        onVisibleCenterChange({
          latitude: region.latitude,
          longitude: region.longitude,
        });
      }}
    >
      {clusters.map((cluster) => {
        const station = cluster.stations[0];
        const isCluster = cluster.stations.length > 1;

        return (
          <Marker
            key={isCluster ? `cluster:${cluster.id}` : station.id}
            coordinate={{
              latitude: cluster.latitude,
              longitude: cluster.longitude,
            }}
            onPress={() => {
              if (isCluster) zoomToCluster(cluster);
              else onSelectStation(station);
            }}
            tracksViewChanges={false}
          >
            {isCluster ? (
              <TouchableOpacity onPress={() => zoomToCluster(cluster)} activeOpacity={0.85}>
                <View style={[styles.cluster, { borderColor: fuelColor }]}>
                  <Text style={[styles.clusterText, { color: fuelColor }]}>
                    {cluster.stations.length}
                  </Text>
                </View>
                <View style={[styles.arrow, { borderTopColor: fuelColor }]} />
              </TouchableOpacity>
            ) : (
              <MapStationMarker
                station={station}
                selectedFuelType={selectedFuelType}
                isSelected={selectedStation?.id === station.id}
                onPress={() => onSelectStation(station)}
              />
            )}
          </Marker>
        );
      })}
      {selectedStationWithPrice && (
        <Marker
          key={`selected:${selectedStationWithPrice.id}`}
          coordinate={{
            latitude: selectedStationWithPrice.latitude,
            longitude: selectedStationWithPrice.longitude,
          }}
          onPress={() => onSelectStation(selectedStationWithPrice)}
          tracksViewChanges
        >
          <MapStationMarker
            station={selectedStationWithPrice}
            selectedFuelType={selectedFuelType}
            isSelected
            onPress={() => onSelectStation(selectedStationWithPrice)}
          />
        </Marker>
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  cluster: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    backgroundColor: "#1A1A27",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  clusterText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
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
