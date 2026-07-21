import { getStationDetail } from "@/server/db/public-api";

import { handleStationDetail } from "./handler";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  return handleStationDetail(request, id, { getStationDetail });
}
