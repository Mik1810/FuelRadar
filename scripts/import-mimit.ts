import postgres from "postgres";

import { parseRuntimeEnv } from "@/config/server-env";
import { runMimitImport } from "@/server/mimit/importer";
import {
  downloadMimitDataset,
  fetchMimitDatasetMetadata,
} from "@/server/mimit/source-client";

const { DATABASE_URL } = parseRuntimeEnv(process.env);
const sql = postgres(DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  idle_timeout: 20,
});

try {
  const result = await runMimitImport({
    sql,
    fetchMetadata: fetchMimitDatasetMetadata,
    downloadDataset: downloadMimitDataset,
  });
  console.info(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "MIMIT import failed.");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
