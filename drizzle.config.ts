import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./supabase/migrations",
  schemaFilter: ["fuelradar"],
  extensionsFilters: ["postgis"],
  migrations: {
    prefix: "supabase",
  },
  strict: true,
  verbose: true,
});
