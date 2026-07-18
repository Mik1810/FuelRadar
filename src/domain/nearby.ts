import { z } from "zod";

import { FUEL_TYPES, SERVICE_MODES } from "@/domain/fuel";

export const nearbySearchSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  radiusKm: z.number().finite().positive().max(50).default(10),
  fuelType: z.enum(FUEL_TYPES),
  serviceMode: z.enum(SERVICE_MODES),
  limit: z.number().int().positive().max(200).default(50),
});

export type NearbySearch = z.input<typeof nearbySearchSchema>;

export const nearbyStationSchema = z.object({
  station_id: z.string(),
  operator: z.string(),
  brand: z.string(),
  station_type: z.string(),
  name: z.string(),
  address: z.string(),
  city: z.string(),
  province: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  fuel_type: z.enum(FUEL_TYPES),
  service_mode: z.enum(SERVICE_MODES),
  price: z.number().positive(),
  communicated_at: z.string(),
  distance_km: z.number().nonnegative(),
});

export type NearbyStation = z.infer<typeof nearbyStationSchema>;
