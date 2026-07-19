import "server-only";

import {
  MimitCronDatabaseUnavailableError,
  runMimitCronImport,
  type MimitCronResult,
} from "@/server/mimit/cron-import";
import {
  downloadMimitDataset,
  fetchMimitDatasetMetadata,
  isTransientMimitFetchError,
} from "@/server/mimit/source-client";

export async function runServerMimitCronImport(): Promise<MimitCronResult> {
  let sqlClient: (typeof import("@/server/db/client"))["sqlClient"];
  try {
    ({ sqlClient } = await import("@/server/db/client"));
  } catch (error) {
    try {
      console.error(
        "DB_CLIENT_INIT_ERROR " +
          JSON.stringify({
            name: error instanceof Error ? error.constructor.name : typeof error,
            hasCode: error && typeof error === "object" && "code" in error,
            isTypeError: error instanceof TypeError,
          }),
      );
    } catch {}
    throw new MimitCronDatabaseUnavailableError(
      error,
      "client_initialization_failed",
    );
  }

  try {
    return await runMimitCronImport({
      sql: sqlClient,
      fetchMetadata: fetchMimitDatasetMetadata,
      downloadDataset: downloadMimitDataset,
      isTransientFetchError: isTransientMimitFetchError,
    });
  } catch (error) {
    try {
      console.error(
        "DB_CLAIM_ERROR " +
          JSON.stringify({
            name: error instanceof Error ? error.constructor.name : typeof error,
            hasCode: error && typeof error === "object" && "code" in error,
            isTypeError: error instanceof TypeError,
          }),
      );
    } catch {}
    throw error;
  }
}
