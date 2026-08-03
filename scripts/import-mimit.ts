import postgres from "postgres";

import { parseRuntimeEnv } from "@/config/server-env";
import { runMimitCronImport } from "@/server/mimit/cron-import";
import {
  downloadMimitPrices,
  downloadMimitStations,
  fetchMimitDatasetMetadata,
  isTransientMimitFetchError,
} from "@/server/mimit/source-client";

const { DATABASE_URL, MIMIT_RETENTION_ENABLED } = parseRuntimeEnv(process.env);
const sql = postgres(DATABASE_URL.trim(), {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  idle_timeout: 20,
});

try {
  const result = await runMimitCronImport({
    sql,
    fetchMetadata: fetchMimitDatasetMetadata,
    downloadStations: downloadMimitStations,
    downloadPrices: downloadMimitPrices,
    isTransientFetchError: isTransientMimitFetchError,
    pruneHistoricalDatasets: MIMIT_RETENTION_ENABLED,
  });
  console.info(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "MIMIT import failed.");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
