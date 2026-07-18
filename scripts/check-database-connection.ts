import { sql } from "drizzle-orm";

import { parseRuntimeEnv } from "@/config/server-env";
import { createDatabaseConnection } from "@/server/db/connection";

const { DATABASE_URL } = parseRuntimeEnv(process.env);
const { db, sqlClient } = createDatabaseConnection(DATABASE_URL);

try {
  const result = await db.execute<{
    schema_exists: boolean;
    postgis_enabled: boolean;
  }>(sql`
    select
      exists(
        select 1
        from information_schema.schemata
        where schema_name = 'fuelradar'
      ) as schema_exists,
      exists(
        select 1
        from pg_extension
        where extname = 'postgis'
      ) as postgis_enabled
  `);
  const status = result[0];

  if (!status?.schema_exists || !status.postgis_enabled) {
    throw new Error("Database is reachable but FuelRadar prerequisites are missing");
  }

  console.log("Database connection verified: fuelradar schema and PostGIS are available.");
} finally {
  await sqlClient.end({ timeout: 5 });
}
