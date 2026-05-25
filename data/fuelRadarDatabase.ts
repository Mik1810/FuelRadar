import * as SQLite from "expo-sqlite";

const DATABASE_NAME = "fuelradar.db";
const SCHEMA_VERSION = 1;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function openFuelRadarDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME);
  }

  return databasePromise;
}

export async function initFuelRadarDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await openFuelRadarDatabase();

  await db.execAsync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS dataset_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      brand TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prices (
      station_id TEXT NOT NULL,
      fuel_type TEXT NOT NULL,
      service_mode TEXT NOT NULL,
      price REAL NOT NULL,
      communicated_at TEXT NOT NULL,
      PRIMARY KEY (station_id, fuel_type, service_mode),
      FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_stations_coordinates
      ON stations(latitude, longitude);

    CREATE INDEX IF NOT EXISTS idx_prices_fuel_service
      ON prices(fuel_type, service_mode);

    PRAGMA user_version = ${SCHEMA_VERSION};
  `);

  return db;
}
