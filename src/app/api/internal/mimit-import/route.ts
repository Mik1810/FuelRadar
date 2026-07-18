import { NextResponse } from "next/server";

import { createMimitImportHandler } from "@/app/api/internal/mimit-import/handler";
import { parseCronEnv, parseRuntimeEnv } from "@/config/server-env";
import { MimitCronConfigurationError } from "@/server/mimit/cron-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handleImport = createMimitImportHandler({
  getSecret: () => parseCronEnv(process.env).CRON_SECRET,
  runImport: async () => {
    try {
      parseRuntimeEnv(process.env);
    } catch (error) {
      throw new MimitCronConfigurationError(error);
    }

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
