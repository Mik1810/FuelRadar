import { getActiveDatasetStatus } from "@/server/db/public-api";

import { handleDatasetStatus } from "./handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleDatasetStatus(request, { getActiveDatasetStatus });
}
