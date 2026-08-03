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
  const now = () => new Date("2026-05-24T12:00:00.000Z");

  let downloads = 0;
  const first = await runMimitImport({
    sql,
    now,
    fetchMetadata: async () => metadata("v1"),
    downloadStations: async () => {
      downloads += 1;
      return download(pricesText).stations;
    },
    downloadPrices: async () => download(pricesText).prices,
  });
  assert(first.status === "succeeded", "The valid import did not succeed.");
  assert(first.stationCount === 1, "The valid station count is incorrect.");
  assert(first.priceCount === 2, "The valid price count is incorrect.");

  await sql`
    update fuelradar.datasets
    set source_metadata = source_metadata #- ${["stations", "contentFingerprint"]}::text[]
    where is_active
  `;
  const legacyBackfill = await runMimitImport({
    sql,
    now,
    fetchMetadata: async () => metadata("v1"),
    downloadStations: async () => {
      downloads += 1;
      return download(pricesText).stations;
    },
    downloadPrices: async () => download(pricesText).prices,
  });
  const [backfilled] = await sql<
    { station_content_fingerprint: string | null }[]
  >`
    select source_metadata->'stations'->>'contentFingerprint'
      as station_content_fingerprint
    from fuelradar.datasets
    where is_active
  `;
  assert(
    legacyBackfill.reason === "content-unchanged" &&
      Boolean(backfilled?.station_content_fingerprint),
    "Unchanged legacy content did not backfill the station fingerprint.",
  );

  const repeated = await runMimitImport({
    sql,
    now,
    fetchMetadata: async () => metadata("v1"),
    downloadStations: async () => {
      downloads += 1;
      return download(pricesText).stations;
    },
    downloadPrices: async () => {
      downloads += 1;
      return download(pricesText).prices;
    },
  });
  assert(repeated.status === "skipped", "Unchanged metadata was not skipped.");
  assert(downloads === 2, "Unchanged metadata triggered another download.");

  let unexpectedStationDownloads = 0;
  const dailyPrices = await runMimitImport({
    sql,
    now,
    fetchMetadata: async () => metadata("v2"),
    downloadStations: async () => {
      unexpectedStationDownloads += 1;
      return download(pricesText, "\n").stations;
    },
    downloadPrices: async () => download(pricesText, "\n").prices,
  });
  assert(dailyPrices.status === "succeeded", "The daily price refresh failed.");
  assert(
    dailyPrices.maintenance?.stationsRefreshed === false,
    "The daily price refresh unexpectedly refreshed stations.",
  );
  assert(
    dailyPrices.maintenance?.prunedDatasetCount === 1,
    "The previous dataset was not pruned atomically.",
  );
  assert(
    unexpectedStationDownloads === 0,
    "The daily price refresh downloaded stations.",
  );

  const gatedRetention = await runMimitImport({
    sql,
    now,
    fetchMetadata: async () => metadata("v3"),
    downloadStations: async () => download(pricesText, "\n\n\n\n\n\n").stations,
    downloadPrices: async () => download(pricesText, "\n\n\n\n\n\n").prices,
    pruneHistoricalDatasets: false,
  });
  const [{ dataset_count: gatedDatasetCount }] = await sql<
    { dataset_count: number }[]
  >`select count(*)::int as dataset_count from fuelradar.datasets`;
  assert(
    gatedRetention.maintenance?.prunedDatasetCount === 0 &&
      gatedDatasetCount === 2,
    "The disabled retention gate deleted a dataset.",
  );

  let malformedFailed = false;
  try {
    await runMimitImport({
      sql,
      now,
      fetchMetadata: async () => metadata("broken"),
      downloadStations: async () => download(malformedPricesText).stations,
      downloadPrices: async () => download(malformedPricesText).prices,
    });
  } catch {
    malformedFailed = true;
  }
  assert(malformedFailed, "The malformed CSV import unexpectedly succeeded.");

  let interrupted = false;
  try {
    await runMimitImport({
      sql,
      now,
      fetchMetadata: async () => metadata("interrupted"),
      downloadStations: async () => download(pricesText, "\n\n").stations,
      downloadPrices: async () => download(pricesText, "\n\n").prices,
      beforeActivation: async () => {
        throw new Error("simulated interruption before activation");
      },
    });
  } catch {
    interrupted = true;
  }
  assert(interrupted, "The simulated interruption unexpectedly succeeded.");

  let afterActivationFailed = false;
  try {
    await runMimitImport({
      sql,
      now,
      fetchMetadata: async () => metadata("after-activation"),
      downloadStations: async () => download(pricesText, "\n\n\n").stations,
      downloadPrices: async () => download(pricesText, "\n\n\n").prices,
      afterActivation: async () => {
        throw new Error("simulated interruption after activation");
      },
    });
  } catch {
    afterActivationFailed = true;
  }
  assert(
    afterActivationFailed,
    "The post-activation interruption unexpectedly succeeded.",
  );

  await sql`
    create or replace function fuelradar.fail_test_dataset_delete()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'simulated retention delete failure';
    end
    $$
  `;
  await sql`
    create trigger fail_test_dataset_delete
    before delete on fuelradar.datasets
    for each row execute function fuelradar.fail_test_dataset_delete()
  `;
  let retentionFailed = false;
  try {
    await runMimitImport({
      sql,
      now,
      fetchMetadata: async () => metadata("retention-failure"),
      downloadStations: async () => download(pricesText, "\n\n\n\n").stations,
      downloadPrices: async () => download(pricesText, "\n\n\n\n").prices,
    });
  } catch {
    retentionFailed = true;
  } finally {
    await sql`drop trigger fail_test_dataset_delete on fuelradar.datasets`;
    await sql`drop function fuelradar.fail_test_dataset_delete()`;
  }
  assert(retentionFailed, "The simulated retention failure unexpectedly succeeded.");

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
    now,
    fetchMetadata: async () => metadata(null),
    downloadStations: async () => download(pricesText, "\n\n\n\n\n").stations,
    downloadPrices: async () => download(pricesText, "\n\n\n\n\n").prices,
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
  const concurrentSkip = concurrent.find(({ status }) => status === "skipped");
  assert(
    concurrentSkip?.reason === "already-running",
    "The conflicting concurrent import was not recorded as already running.",
  );

  const monthlyStationsText = stationsText.replaceAll("2026-05-23", "2026-06-23");
  const monthlyPricesText = pricesText
    .replaceAll("2026-05-23", "2026-06-23")
    .replaceAll("23/05/2026", "23/06/2026")
    .replaceAll("22/05/2026", "22/06/2026");
  let monthlyStationDownloads = 0;
  const monthly = await runMimitImport({
    sql,
    now: () => new Date("2026-06-24T12:00:00.000Z"),
    fetchMetadata: async () => metadata("monthly"),
    downloadStations: async () => {
      monthlyStationDownloads += 1;
      return {
        name: "stations",
        url: "https://example.test/stations.csv",
        text: monthlyStationsText,
        downloadedAt: "2026-06-24T12:00:01.000Z",
      };
    },
    downloadPrices: async () => ({
      name: "prices",
      url: "https://example.test/prices.csv",
      text: monthlyPricesText,
      downloadedAt: "2026-06-24T12:00:01.000Z",
    }),
  });
  assert(monthly.status === "succeeded", "The monthly station refresh failed.");
  assert(
    monthly.maintenance?.stationsRefreshed === true,
    "The due monthly refresh reused stale stations.",
  );
  assert(monthlyStationDownloads === 1, "Stations were not downloaded exactly once.");

  const [summary] = await sql<
    {
      active_count: number;
      dataset_count: number;
      succeeded: number;
      skipped: number;
      failed: number;
      leaked_errors: number;
      detached_successes: number;
      orphan_prices: number;
    }[]
  >`
    select
      (select count(*)::int from fuelradar.datasets where is_active) as active_count,
      (select count(*)::int from fuelradar.datasets) as dataset_count,
      count(*) filter (where status = 'succeeded')::int as succeeded,
      count(*) filter (where status = 'skipped')::int as skipped,
      count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (
        where status = 'succeeded' and dataset_id is null
      )::int as detached_successes,
      (select count(*)::int
        from fuelradar.prices as price
        left join fuelradar.stations as station
          on station.dataset_id = price.dataset_id
         and station.id = price.station_id
        where station.id is null) as orphan_prices,
      count(*) filter (
        where error_message like '%postgresql://%@%' or length(error_message) > 500
      )::int as leaked_errors
    from fuelradar.import_runs
  `;
  assert(summary?.active_count === 1, "More than one dataset is active.");
  assert(summary.dataset_count === 1, "Retention left an inactive dataset behind.");
  assert(summary.succeeded === 5, "Unexpected successful run count.");
  assert(summary.skipped === 3, "Unexpected skipped run count.");
  assert(summary.failed === 4, "Unexpected failed run count.");
  assert(summary.detached_successes === 4, "Historical import runs were not detached.");
  assert(summary.orphan_prices === 0, "Retention left orphan prices.");
  assert(summary.leaked_errors === 0, "An import error leaked unsafe details.");

  console.info(
    "MIMIT importer: monthly stations, daily prices, retention, failures, and concurrency passed.",
  );
} finally {
  await sql.end({ timeout: 5 });
}
