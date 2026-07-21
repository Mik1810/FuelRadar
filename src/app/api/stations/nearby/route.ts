import { getNearbyStations } from "@/server/db/public-api";

import { handleNearbyStations } from "./handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleNearbyStations(request, { getNearbyStations });
}
