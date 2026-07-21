import { z } from "zod";

import { FUEL_TYPES, SERVICE_MODES } from "@/domain/fuel";
import {
  MAX_STATION_ID_LENGTH,
  STATION_ID_PATTERN,
} from "@/domain/station-id";

export { MAX_STATION_ID_LENGTH } from "@/domain/station-id";
export const DATASET_FRESHNESS_MAX_AGE_DAYS = 1;

const isoDateSchema = z.iso.date();
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const LOCAL_CIVIL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const localCivilDateTimeSchema = z
  .string()
  .refine((value) => {
    const match = LOCAL_CIVIL_DATE_TIME.exec(value);
    if (!match) return false;
    const [year, month, day, hour, minute, second] = match
      .slice(1)
      .map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day &&
      parsed.getUTCHours() === hour &&
      parsed.getUTCMinutes() === minute &&
      parsed.getUTCSeconds() === second
    );
  });

const stationFields = {
  id: z.string().min(1).max(MAX_STATION_ID_LENGTH),
  operator: z.string().max(256),
  brand: z.string().max(100),
  stationType: z.string().max(100),
  name: z.string().max(256),
  address: z.string().max(512),
  city: z.string().max(128),
  province: z.string().max(8),
};

export const stationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_STATION_ID_LENGTH)
  .regex(STATION_ID_PATTERN);

export const publicPriceSchema = z.object({
  fuelType: z.enum(FUEL_TYPES),
  serviceMode: z.enum(SERVICE_MODES),
  price: z.number().positive(),
  communicatedAt: localCivilDateTimeSchema,
});

export const publicNearbyStationSchema = z.object({
  ...stationFields,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  fuelType: z.enum(FUEL_TYPES),
  serviceMode: z.enum(SERVICE_MODES),
  price: z.number().positive(),
  communicatedAt: localCivilDateTimeSchema,
  distanceKm: z.number().finite().nonnegative(),
});

export const publicStationDetailSchema = z.object({
  ...stationFields,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  prices: publicPriceSchema.array().max(8),
});

export const nearbyResponseSchema = z.object({
  data: z.object({
    extractionDate: isoDateSchema,
    stations: publicNearbyStationSchema.array().max(200),
  }),
});

export const stationDetailResponseSchema = z.object({
  data: z.object({
    extractionDate: isoDateSchema,
    station: publicStationDetailSchema,
  }),
});

export const importSummarySchema = z.object({
  status: z.enum(["running", "succeeded", "failed", "skipped"]),
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});

export const datasetStatusSchema = z.object({
  extractionDate: isoDateSchema,
  stationsExtractionDate: isoDateSchema,
  pricesExtractionDate: isoDateSchema,
  importedAt: isoDateTimeSchema,
  activatedAt: isoDateTimeSchema,
  stationCount: z.number().int().nonnegative(),
  priceCount: z.number().int().nonnegative(),
  freshness: z.object({
    ageDays: z.number().int().nonnegative(),
    status: z.enum(["fresh", "stale"]),
  }),
  latestImport: importSummarySchema.nullable(),
});

export const datasetStatusResponseSchema = z.object({ data: datasetStatusSchema });

export type PublicNearbyStation = z.infer<typeof publicNearbyStationSchema>;
export type PublicStationDetail = z.infer<typeof publicStationDetailSchema>;
export type DatasetStatus = z.infer<typeof datasetStatusSchema>;

export type NearbyStationsResult =
  | { status: "dataset-unavailable" }
  | {
      status: "ok";
      extractionDate: string;
      stations: PublicNearbyStation[];
    };

export type StationDetailResult =
  | { status: "dataset-unavailable" }
  | { status: "station-not-found"; extractionDate: string }
  | {
      status: "ok";
      extractionDate: string;
      station: PublicStationDetail;
    };

function calendarDay(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function getDatasetFreshness(
  extractionDate: string,
  now: Date = new Date(),
): DatasetStatus["freshness"] {
  const parsedExtractionDate = isoDateSchema.parse(extractionDate);
  const todayInRome = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const ageDays = Math.max(
    0,
    Math.floor(
      (calendarDay(todayInRome) - calendarDay(parsedExtractionDate)) /
        86_400_000,
    ),
  );

  return {
    ageDays,
    status:
      ageDays <= DATASET_FRESHNESS_MAX_AGE_DAYS ? "fresh" : "stale",
  };
}
