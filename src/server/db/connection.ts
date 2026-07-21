import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";

const POSTGRES_OPTIONS = {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
} as const;

export function createDatabaseConnection(databaseUrl: string) {
  const trimmedDatabaseUrl = databaseUrl.trim();
  const sqlClient = postgres(trimmedDatabaseUrl, POSTGRES_OPTIONS);

  // Drizzle replaces postgres.js date and JSON serializers with identity
  // functions. Keep its client isolated so raw tagged queries retain the
  // postgres.js serializers expected by the importer and nearby search.
  const drizzleSqlClient = postgres(trimmedDatabaseUrl, POSTGRES_OPTIONS);
  const db = drizzle(drizzleSqlClient, { schema });

  return {
    sqlClient,
    db,
    async close(): Promise<void> {
      await Promise.all([
        sqlClient.end({ timeout: 5 }),
        drizzleSqlClient.end({ timeout: 5 }),
      ]);
    },
  };
}
