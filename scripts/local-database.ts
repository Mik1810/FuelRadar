import postgres from "postgres";

export const DEFAULT_LOCAL_DATABASE_URL =
  "postgresql://fuelradar:fuelradar@127.0.0.1:5432/fuelradar_local";

export function getLocalDatabaseUrl(): string {
  const value = process.env.LOCAL_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL;
  const url = new URL(value);

  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !["", "5432"].includes(url.port)
  ) {
    throw new Error(
      "LOCAL_DATABASE_URL must target PostgreSQL on localhost port 5432.",
    );
  }

  const database = url.pathname.slice(1);
  if (database !== "fuelradar_local") {
    throw new Error("LOCAL_DATABASE_URL must target the fuelradar_local database.");
  }

  return value;
}

export function databaseName(databaseUrl: string): string {
  return new URL(databaseUrl).pathname.slice(1);
}

export function adminDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = "/postgres";
  return url.toString();
}

export function connectLocalDatabase(databaseUrl = getLocalDatabaseUrl()) {
  return postgres(databaseUrl, {
    prepare: false,
    max: 4,
    connect_timeout: 10,
    onnotice: () => {},
  });
}
