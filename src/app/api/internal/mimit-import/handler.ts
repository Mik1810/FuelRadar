import { NextResponse } from "next/server";

import type { MimitCronResult } from "@/server/mimit/cron-import";
import { hasValidCronAuthorization } from "@/server/mimit/cron-auth";

type MimitImportHandlerDependencies = {
  getSecret: () => string;
  runImport: () => Promise<MimitCronResult>;
  logger: Pick<Console, "error" | "info">;
  now?: () => number;
};

function publicResult(result: MimitCronResult) {
  return {
    status: result.status,
    runId: result.runId,
    datasetId: result.datasetId,
    stationCount: result.stationCount,
    priceCount: result.priceCount,
    durationMs: result.durationMs,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

export function createMimitImportHandler(
  dependencies: MimitImportHandlerDependencies,
) {
  return async function handleImport(request: Request): Promise<NextResponse> {
    const now = dependencies.now ?? Date.now;
    const requestStartedAt = now();
    let cronSecret: string;
    try {
      cronSecret = dependencies.getSecret();
    } catch {
      dependencies.logger.error(
        JSON.stringify({
          event: "mimit_import_configuration_error",
          durationMs: now() - requestStartedAt,
        }),
      );
      return NextResponse.json(
        { error: { code: "service_unavailable", message: "Service unavailable" } },
        { status: 503 },
      );
    }

    if (
      !hasValidCronAuthorization(
        request.headers.get("authorization"),
        cronSecret,
      )
    ) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 },
      );
    }

    try {
      const result = await dependencies.runImport();
      const payload = publicResult(result);
      dependencies.logger.info(
        JSON.stringify({ event: "mimit_import_completed", ...payload }),
      );
      return NextResponse.json(payload, {
        status: result.reason === "already-running" ? 409 : 200,
      });
    } catch {
      dependencies.logger.error(
        JSON.stringify({
          event: "mimit_import_failed",
          durationMs: now() - requestStartedAt,
        }),
      );
      return NextResponse.json(
        { error: { code: "import_failed", message: "MIMIT import failed" } },
        { status: 500 },
      );
    }
  };
}
