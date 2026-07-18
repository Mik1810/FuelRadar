import "server-only";

import { createDatabaseConnection } from "@/server/db/connection";
import { getRuntimeEnv } from "@/server/env";

type DatabaseConnection = ReturnType<typeof createDatabaseConnection>;

const globalDatabase = globalThis as typeof globalThis & {
  fuelRadarDatabase?: DatabaseConnection;
};

function connect(): DatabaseConnection {
  const { DATABASE_URL } = getRuntimeEnv();
  return createDatabaseConnection(DATABASE_URL);
}

const connection = globalDatabase.fuelRadarDatabase ?? connect();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.fuelRadarDatabase = connection;
}

export const { db, sqlClient } = connection;

export async function closeDatabaseConnection(): Promise<void> {
  await sqlClient.end({ timeout: 5 });
}
