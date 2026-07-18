import postgres from "postgres";

import type {
  MimitDatasetMetadata,
  MimitResourceDownload,
} from "@/domain/mimit/source";
import { runMimitImport } from "@/server/mimit/importer";
import { getLocalDatabaseUrl } from "./local-database";

const localDatabaseUrl = getLocalDatabaseUrl();

const sql = postgres(localDatabaseUrl, {
  prepare: false,
  max: 4,
  connect_timeout: 10,
});

const stationsText = await Bun.file(
  "src/domain/mimit/__fixtures__/stations.valid.csv",
).text();
const pricesText = await Bun.file(
  "src/domain/mimit/__fixtures__/prices.valid.csv",
).text();
const malformedPricesText = await Bun.file(
  "src/domain/mimit/__fixtures__/prices.malformed.csv",
).text();

function metadata(version: string | null): MimitDatasetMetadata {
  const checkedAt = "2026-07-18T12:00:00.000Z";
  const resource = (name: "stations" | "prices") => ({
    name,
    url: `https://example.test/${name}.csv`,
    etag: version ? `"${name}-${version}"` : null,
    lastModified: version ? "Sat, 18 Jul 2026 12:00:00 GMT" : null,
    contentLength: name === "stations" ? stationsText.length : pricesText.length,
    contentType: "text/csv",
    checkedAt,
  });
  return { stations: resource("stations"), prices: resource("prices") };
}

function download(
  prices: string,
  suffix = "",
): { stations: MimitResourceDownload; prices: MimitResourceDownload } {
  return {
    stations: {
      name: "stations",
      url: "https://example.test/stations.csv",
      text: stationsText + suffix,
      downloadedAt: "2026-07-18T12:00:01.000Z",
    },
    prices: {
      name: "prices",
      url: "https://example.test/prices.csv",
      text: prices + suffix,
      downloadedAt: "2026-07-18T12:00:01.000Z",
    },
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  await sql`truncate fuelradar.import_runs, fuelradar.datasets restart identity cascade`;

  let downloads = 0;
  const first = await runMimitImport({
    sql,
    fetchMetadata: async () => metadata("v1"),
    downloadDataset: async () => {
      downloads += 1;
      return download(pricesText);
    },
  });
  assert(first.status === "succeeded", "The valid import did not succeed.");
  assert(first.stationCount === 1, "The valid station count is incorrect.");
  assert(first.priceCount === 2, "The valid price count is incorrect.");

  const repeated = await runMimitImport({
    sql,
    fetchMetadata: async () => metadata("v1"),
    downloadDataset: async () => {
      downloads += 1;
      return download(pricesText);
    },
  });
  assert(repeated.status === "skipped", "Unchanged metadata was not skipped.");
  assert(downloads === 1, "Unchanged metadata triggered another download.");

  let malformedFailed = false;
  try {
    await runMimitImport({
      sql,
      fetchMetadata: async () => metadata("broken"),
      downloadDataset: async () => download(malformedPricesText),
    });
  } catch {
    malformedFailed = true;
  }
  assert(malformedFailed, "The malformed CSV import unexpectedly succeeded.");

  let interrupted = false;
  try {
    await runMimitImport({
      sql,
      fetchMetadata: async () => metadata("interrupted"),
      downloadDataset: async () => download(pricesText, "\n"),
      beforeActivation: async () => {
        throw new Error("simulated interruption before activation");
      },
    });
  } catch {
    interrupted = true;
  }
  assert(interrupted, "The simulated interruption unexpectedly succeeded.");

  const [afterFailures] = await sql<
    { active_count: number; station_count: number; price_count: number }[]
  >`
    select
      count(*) filter (where is_active)::int as active_count,
      max(station_count) filter (where is_active)::int as station_count,
      max(price_count) filter (where is_active)::int as price_count
    from fuelradar.datasets
  `;
  assert(afterFailures?.active_count === 1, "A failure changed the active dataset.");
  assert(afterFailures.station_count === 1, "The active station count changed.");
  assert(afterFailures.price_count === 2, "The active price count changed.");

  const concurrentDependencies = {
    sql,
    fetchMetadata: async () => metadata(null),
    downloadDataset: async () => download(pricesText, "\n\n"),
  };
  const concurrent = await Promise.all([
    runMimitImport(concurrentDependencies),
    runMimitImport(concurrentDependencies),
  ]);
  assert(
    concurrent.filter(({ status }) => status === "succeeded").length === 1,
    "Concurrent imports did not produce exactly one successful swap.",
  );
  assert(
    concurrent.filter(({ status }) => status === "skipped").length === 1,
    "Concurrent imports did not skip the duplicate content.",
  );

  const [summary] = await sql<
    {
      active_count: number;
      succeeded: number;
      skipped: number;
      failed: number;
      leaked_errors: number;
    }[]
  >`
    select
      (select count(*)::int from fuelradar.datasets where is_active) as active_count,
      count(*) filter (where status = 'succeeded')::int as succeeded,
      count(*) filter (where status = 'skipped')::int as skipped,
      count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (
        where error_message like '%postgresql://%@%' or length(error_message) > 500
      )::int as leaked_errors
    from fuelradar.import_runs
  `;
  assert(summary?.active_count === 1, "More than one dataset is active.");
  assert(summary.succeeded === 2, "Unexpected successful run count.");
  assert(summary.skipped === 2, "Unexpected skipped run count.");
  assert(summary.failed === 2, "Unexpected failed run count.");
  assert(summary.leaked_errors === 0, "An import error leaked unsafe details.");

  console.info(
    "MIMIT importer: valid, unchanged, malformed, interrupted, and concurrent scenarios passed.",
  );
} finally {
  await sql.end({ timeout: 5 });
}
