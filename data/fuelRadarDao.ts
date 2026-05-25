import type {
  FuelRadarDataset,
  FuelRadarPrice,
  FuelRadarStation,
  ServiceMode,
} from "@/data/fuelRadarData";
import { initFuelRadarDatabase } from "@/data/fuelRadarDatabase";

type StationRow = {
  id: string;
  name: string;
  brand: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
};

type PriceRow = {
  station_id: string;
  fuel_type: FuelRadarPrice["fuelType"];
  service_mode: ServiceMode;
  price: number;
  communicated_at: string;
};

type MetadataRow = {
  key: string;
  value: string;
};

export type NearbyFuelRadarDatasetQuery = {
  latitude: number;
  longitude: number;
  radiusKm: number;
  fuelType: FuelRadarPrice["fuelType"];
  serviceMode: ServiceMode;
};

function getDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const earthRadiusKm = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function mapStationRow(station: StationRow): FuelRadarStation {
  return {
    id: station.id,
    name: station.name,
    brand: station.brand,
    address: station.address,
    city: station.city,
    latitude: station.latitude,
    longitude: station.longitude,
  };
}

function mapPriceRow(price: PriceRow): FuelRadarPrice {
  return {
    stationId: price.station_id,
    fuelType: price.fuel_type,
    serviceMode: price.service_mode,
    price: price.price,
    communicatedAt: price.communicated_at,
  };
}

export async function getDatasetExtractionDate(): Promise<string | null> {
  const db = await initFuelRadarDatabase();
  const metadata = await db.getFirstAsync<MetadataRow>(
    "SELECT key, value FROM dataset_metadata WHERE key = ?",
    "extraction_date"
  );

  return metadata?.value ?? null;
}

export async function getMetadataValues(
  keys: string[]
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};

  const db = await initFuelRadarDatabase();
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await db.getAllAsync<MetadataRow>(
    `SELECT key, value
      FROM dataset_metadata
      WHERE key IN (${placeholders})`,
    ...keys
  );

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function setMetadataValues(
  values: Record<string, string | number | null | undefined>
): Promise<void> {
  const entries = Object.entries(values).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return;

  const db = await initFuelRadarDatabase();
  const updatedAt = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (const [key, value] of entries) {
      await db.runAsync(
        `INSERT OR REPLACE INTO dataset_metadata (key, value, updated_at)
          VALUES (?, ?, ?)`,
        key,
        String(value),
        updatedAt
      );
    }
  });
}

export async function replaceFuelRadarDataset(dataset: FuelRadarDataset): Promise<void> {
  const db = await initFuelRadarDatabase();
  const updatedAt = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      DELETE FROM prices;
      DELETE FROM stations;
    `);

    for (const station of dataset.stations) {
      await db.runAsync(
        `INSERT INTO stations (
          id,
          name,
          brand,
          address,
          city,
          latitude,
          longitude
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        station.id,
        station.name,
        station.brand,
        station.address,
        station.city,
        station.latitude,
        station.longitude
      );
    }

    for (const price of dataset.prices) {
      await db.runAsync(
        `INSERT INTO prices (
          station_id,
          fuel_type,
          service_mode,
          price,
          communicated_at
        ) VALUES (?, ?, ?, ?, ?)`,
        price.stationId,
        price.fuelType,
        price.serviceMode,
        price.price,
        price.communicatedAt
      );
    }

    await db.runAsync(
      `INSERT OR REPLACE INTO dataset_metadata (key, value, updated_at)
        VALUES (?, ?, ?)`,
      "extraction_date",
      dataset.extractionDate,
      updatedAt
    );
  });
}

export async function loadFuelRadarDataset(): Promise<FuelRadarDataset> {
  const extractionDate = await getDatasetExtractionDate();

  if (!extractionDate) {
    throw new Error("Local database has no imported dataset");
  }

  const db = await initFuelRadarDatabase();
  const stationRows = await db.getAllAsync<StationRow>(
    `SELECT id, name, brand, address, city, latitude, longitude
      FROM stations
      ORDER BY id`
  );
  const priceRows = await db.getAllAsync<PriceRow>(
    `SELECT station_id, fuel_type, service_mode, price, communicated_at
      FROM prices
      ORDER BY station_id, fuel_type, service_mode`
  );

  return {
    extractionDate,
    stations: stationRows.map(mapStationRow),
    prices: priceRows.map(mapPriceRow),
  };
}

export async function loadNearbyFuelRadarDataset(
  query: NearbyFuelRadarDatasetQuery
): Promise<FuelRadarDataset> {
  const extractionDate = await getDatasetExtractionDate();

  if (!extractionDate) {
    throw new Error("Local database has no imported dataset");
  }

  const latitudeDelta = query.radiusKm / 111.32;
  const longitudeScale = Math.max(
    Math.abs(Math.cos((query.latitude * Math.PI) / 180)),
    0.01
  );
  const longitudeDelta = query.radiusKm / (111.32 * longitudeScale);
  const db = await initFuelRadarDatabase();

  const stationRows = await db.getAllAsync<StationRow>(
    `SELECT DISTINCT
        s.id,
        s.name,
        s.brand,
        s.address,
        s.city,
        s.latitude,
        s.longitude
      FROM stations s
      INNER JOIN prices p ON p.station_id = s.id
      WHERE p.fuel_type = ?
        AND p.service_mode = ?
        AND s.latitude BETWEEN ? AND ?
        AND s.longitude BETWEEN ? AND ?
      ORDER BY p.price ASC`,
    query.fuelType,
    query.serviceMode,
    query.latitude - latitudeDelta,
    query.latitude + latitudeDelta,
    query.longitude - longitudeDelta,
    query.longitude + longitudeDelta
  );

  const nearbyStations = stationRows.filter(
    (station) =>
      getDistanceKm(
        query.latitude,
        query.longitude,
        station.latitude,
        station.longitude
      ) <= query.radiusKm
  );

  if (nearbyStations.length === 0) {
    return {
      extractionDate,
      stations: [],
      prices: [],
    };
  }

  const stationIds = nearbyStations.map((station) => station.id);
  const placeholders = stationIds.map(() => "?").join(", ");
  const priceRows = await db.getAllAsync<PriceRow>(
    `SELECT station_id, fuel_type, service_mode, price, communicated_at
      FROM prices
      WHERE station_id IN (${placeholders})
      ORDER BY station_id, fuel_type, service_mode`,
    ...stationIds
  );

  return {
    extractionDate,
    stations: nearbyStations.map(mapStationRow),
    prices: priceRows.map(mapPriceRow),
  };
}

export async function loadFuelRadarDatasetByStationIds(
  stationIds: string[]
): Promise<FuelRadarDataset> {
  const extractionDate = await getDatasetExtractionDate();

  if (!extractionDate) {
    throw new Error("Local database has no imported dataset");
  }

  if (stationIds.length === 0) {
    return {
      extractionDate,
      stations: [],
      prices: [],
    };
  }

  const db = await initFuelRadarDatabase();
  const placeholders = stationIds.map(() => "?").join(", ");
  const stationRows = await db.getAllAsync<StationRow>(
    `SELECT id, name, brand, address, city, latitude, longitude
      FROM stations
      WHERE id IN (${placeholders})
      ORDER BY id`,
    ...stationIds
  );
  const priceRows = await db.getAllAsync<PriceRow>(
    `SELECT station_id, fuel_type, service_mode, price, communicated_at
      FROM prices
      WHERE station_id IN (${placeholders})
      ORDER BY station_id, fuel_type, service_mode`,
    ...stationIds
  );

  return {
    extractionDate,
    stations: stationRows.map(mapStationRow),
    prices: priceRows.map(mapPriceRow),
  };
}
