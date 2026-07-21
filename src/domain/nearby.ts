import { z } from "zod";

import { FUEL_TYPES, SERVICE_MODES } from "@/domain/fuel";

export const nearbySearchSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  radiusKm: z.number().finite().min(0.1).max(50).default(10),
  fuelType: z.enum(FUEL_TYPES),
  serviceMode: z.enum(SERVICE_MODES),
  limit: z.number().int().positive().max(200).default(50),
});

export type NearbySearch = z.input<typeof nearbySearchSchema>;
