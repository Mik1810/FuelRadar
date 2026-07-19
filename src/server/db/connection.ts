import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";

export function createDatabaseConnection(databaseUrl: string) {
  const sqlClient = postgres(databaseUrl.trim(), {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    sqlClient,
    db: drizzle(sqlClient, { schema }),
  };
}
