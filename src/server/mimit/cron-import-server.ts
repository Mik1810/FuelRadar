import "server-only";

import { sqlClient } from "@/server/db/client";
import {
  runMimitCronImport,
  type MimitCronResult,
} from "@/server/mimit/cron-import";
import {
  downloadMimitDataset,
  fetchMimitDatasetMetadata,
  isTransientMimitFetchError,
} from "@/server/mimit/source-client";

export async function runServerMimitCronImport(): Promise<MimitCronResult> {
  return runMimitCronImport({
    sql: sqlClient,
    fetchMetadata: fetchMimitDatasetMetadata,
    downloadDataset: downloadMimitDataset,
    isTransientFetchError: isTransientMimitFetchError,
  });
}
