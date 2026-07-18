import "server-only";

import {
  nearbySearchSchema,
  nearbyStationSchema,
  type NearbySearch,
  type NearbyStation,
} from "@/domain/nearby";
import { sqlClient } from "@/server/db/client";

export async function findNearbyStations(
  input: NearbySearch,
): Promise<NearbyStation[]> {
  const search = nearbySearchSchema.parse(input);

  const rows = await sqlClient<NearbyStation[]>`
    select *
    from fuelradar.nearby_stations(
      ${search.latitude}::double precision,
      ${search.longitude}::double precision,
      ${search.radiusKm}::double precision,
      ${search.fuelType}::fuelradar.fuel_type,
      ${search.serviceMode}::fuelradar.service_mode,
      ${search.limit}::integer
    )
  `;

  return nearbyStationSchema.array().parse(rows);
}
