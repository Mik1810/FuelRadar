import { NextResponse } from "next/server";

import { createMimitImportHandler } from "@/app/api/internal/mimit-import/handler";
import { parseCronEnv } from "@/config/server-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handleImport = createMimitImportHandler({
  getSecret: () => parseCronEnv(process.env).CRON_SECRET,
  runImport: async () => {
    const { runServerMimitCronImport } = await import(
      "@/server/mimit/cron-import-server"
    );
    return runServerMimitCronImport();
  },
  logger: console,
});

export async function GET(request: Request): Promise<NextResponse> {
  return handleImport(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleImport(request);
}
