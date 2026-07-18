import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  geometry,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { MimitDatasetDiagnostics } from "@/domain/mimit/dataset";
import { FUEL_TYPES, SERVICE_MODES } from "@/domain/fuel";

export const fuelRadarSchema = pgSchema("fuelradar");

export const fuelTypeEnum = fuelRadarSchema.enum("fuel_type", FUEL_TYPES);
export const serviceModeEnum = fuelRadarSchema.enum(
  "service_mode",
  SERVICE_MODES,
);
export const importStatusEnum = fuelRadarSchema.enum("import_status", [
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

export const datasets = fuelRadarSchema.table(
  "datasets",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    extractionDate: date("extraction_date", { mode: "string" }).notNull(),
    stationsExtractionDate: date("stations_extraction_date", {
      mode: "string",
    }).notNull(),
    pricesExtractionDate: date("prices_extraction_date", {
      mode: "string",
    }).notNull(),
    sourceEtag: text("source_etag"),
    sourceLastModified: text("source_last_modified"),
    importedAt: timestamp("imported_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    activatedAt: timestamp("activated_at", {
      withTimezone: true,
      mode: "date",
    }),
    isActive: boolean("is_active").notNull().default(false),
    stationCount: integer("station_count").notNull(),
    priceCount: integer("price_count").notNull(),
  },
  (table) => [
    uniqueIndex("datasets_extraction_date_key").on(table.extractionDate),
    uniqueIndex("datasets_one_active_idx")
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
    check("datasets_station_count_check", sql`${table.stationCount} >= 0`),
    check("datasets_price_count_check", sql`${table.priceCount} >= 0`),
    check(
      "datasets_activation_check",
      sql`not ${table.isActive} or ${table.activatedAt} is not null`,
    ),
  ],
);

export const stations = fuelRadarSchema.table(
  "stations",
  {
    datasetId: bigint("dataset_id", { mode: "number" }).notNull(),
    id: text("id").notNull(),
    operator: text("operator").notNull(),
    brand: text("brand").notNull(),
    stationType: text("station_type").notNull(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull(),
    province: text("province").notNull(),
    location: geometry("location", {
      type: "point",
      mode: "xy",
      srid: 4326,
    }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "stations_pkey",
      columns: [table.datasetId, table.id],
    }),
    foreignKey({
      name: "stations_dataset_id_fkey",
      columns: [table.datasetId],
      foreignColumns: [datasets.id],
    }).onDelete("cascade"),
    index("stations_dataset_idx").on(table.datasetId),
    index("stations_city_idx").on(table.datasetId, table.city),
    index("stations_location_gist_idx").using("gist", table.location),
  ],
);

export const prices = fuelRadarSchema.table(
  "prices",
  {
    datasetId: bigint("dataset_id", { mode: "number" }).notNull(),
    stationId: text("station_id").notNull(),
    fuelType: fuelTypeEnum("fuel_type").notNull(),
    serviceMode: serviceModeEnum("service_mode").notNull(),
    price: numeric("price", {
      precision: 7,
      scale: 3,
      mode: "number",
    }).notNull(),
    communicatedAt: timestamp("communicated_at", {
      withTimezone: false,
      mode: "string",
    }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "prices_pkey",
      columns: [
        table.datasetId,
        table.stationId,
        table.fuelType,
        table.serviceMode,
      ],
    }),
    foreignKey({
      name: "prices_station_fkey",
      columns: [table.datasetId, table.stationId],
      foreignColumns: [stations.datasetId, stations.id],
    }).onDelete("cascade"),
    check("prices_price_check", sql`${table.price} > 0`),
    index("prices_nearby_lookup_idx").on(
      table.datasetId,
      table.fuelType,
      table.serviceMode,
      table.price,
      table.stationId,
    ),
  ],
);

export const importRuns = fuelRadarSchema.table(
  "import_runs",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    status: importStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", {
      withTimezone: true,
      mode: "date",
    }),
    datasetId: bigint("dataset_id", { mode: "number" }).references(
      () => datasets.id,
      { onDelete: "set null" },
    ),
    sourceEtag: text("source_etag"),
    sourceLastModified: text("source_last_modified"),
    stationCount: integer("station_count"),
    priceCount: integer("price_count"),
    diagnostics: jsonb("diagnostics").$type<MimitDatasetDiagnostics>(),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("import_runs_started_at_idx").on(table.startedAt),
    check(
      "import_runs_finished_at_check",
      sql`${table.finishedAt} is null or ${table.finishedAt} >= ${table.startedAt}`,
    ),
    check(
      "import_runs_station_count_check",
      sql`${table.stationCount} is null or ${table.stationCount} >= 0`,
    ),
    check(
      "import_runs_price_count_check",
      sql`${table.priceCount} is null or ${table.priceCount} >= 0`,
    ),
  ],
);
