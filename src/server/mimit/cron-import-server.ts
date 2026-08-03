import "server-only";

import {
  MimitCronDatabaseUnavailableError,
  runMimitCronImport,
  type MimitCronResult,
} from "@/server/mimit/cron-import";
import {
  downloadMimitPrices,
  downloadMimitStations,
  fetchMimitDatasetMetadata,
  isTransientMimitFetchError,
} from "@/server/mimit/source-client";

export async function runServerMimitCronImport(): Promise<MimitCronResult> {
  let sqlClient: (typeof import("@/server/db/client"))["sqlClient"];
  try {
    ({ sqlClient } = await import("@/server/db/client"));
  } catch (error) {
    throw new MimitCronDatabaseUnavailableError(
      error,
      "client_initialization_failed",
    );
  }

  return runMimitCronImport({
    sql: sqlClient,
    fetchMetadata: fetchMimitDatasetMetadata,
    downloadStations: downloadMimitStations,
    downloadPrices: downloadMimitPrices,
    isTransientFetchError: isTransientMimitFetchError,
  });
}
