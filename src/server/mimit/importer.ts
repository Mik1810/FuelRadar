import { createHash } from "node:crypto";

import type postgres from "postgres";

import type { FuelRadarDataset } from "@/domain/dataset";
import {
  parseMimitDataset,
  parseMimitPricesResource,
  type MimitDatasetDiagnostics,
} from "@/domain/mimit/dataset";
import type {
  MimitDatasetMetadata,
  MimitResourceDownload,
  MimitResourceMetadata,
} from "@/domain/mimit/source";

export const IMPORT_LOCK_KEY = "fuelradar:mimit-import:v1";
const INSERT_CHUNK_SIZE = 2_000;
const MAX_DATABASE_INTEGER = 2_147_483_647;
export const STATION_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1_000;
const UNKNOWN_STATION_ABSOLUTE_THRESHOLD = 100;
const UNKNOWN_STATION_RATIO_THRESHOLD = 0.01;
const UNKNOWN_STATION_RATIO_MINIMUM = 10;

export class MimitImportClaimLostError extends Error {
  constructor() {
    super("MIMIT import claim is no longer active.");
    this.name = "MimitImportClaimLostError";
  }
}

export type MimitImportStatus = "succeeded" | "skipped";

export type MimitImportResult = {
  runId: string;
  datasetId: string | null;
  status: MimitImportStatus;
  stationCount: number;
  priceCount: number;
  durationMs: number;
  reason?: "metadata-unchanged" | "content-unchanged" | "already-running";
  maintenance?: {
    stationsRefreshed: boolean;
    prunedDatasetCount: number;
    prunedStationCount: number;
    prunedPriceCount: number;
  };
};

export type MimitImportDependencies = {
  sql: postgres.Sql | postgres.TransactionSql;
  fetchMetadata: () => Promise<MimitDatasetMetadata>;
  downloadStations: () => Promise<MimitResourceDownload>;
  downloadPrices: () => Promise<MimitResourceDownload>;
  now?: () => Date;
  beforeActivation?: (datasetId: string) => Promise<void>;
  afterActivation?: (datasetId: string) => Promise<void>;
  pruneHistoricalDatasets?: boolean;
  claimedRun?: {
    id: string;
    startedAt: Date;
  };
};

type ActiveDatasetSnapshot = {
  id: string;
  stationsExtractionDate: string;
  stationCount: number;
  sourceMetadata: MimitDatasetMetadata | null;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedDurationMs(startedAtMs: number, finishedAtMs: number): number {
  return Math.min(
    MAX_DATABASE_INTEGER,
    Math.max(0, finishedAtMs - startedAtMs),
  );
}

export function getMimitMetadataFingerprint(
  metadata: MimitDatasetMetadata,
): string | null {
  const versions = [metadata.stations, metadata.prices].map((resource) => {
    if (!resource.etag && !resource.lastModified) return null;
    return {
      name: resource.name,
      etag: resource.etag,
      lastModified: resource.lastModified,
      contentLength: resource.contentLength,
    };
  });

  return versions.every(Boolean) ? sha256(JSON.stringify(versions)) : null;
}

export function getMimitResourceMetadataFingerprint(
  metadata: MimitResourceMetadata,
): string | null {
  if (!metadata.etag && !metadata.lastModified) return null;
  return sha256(
    JSON.stringify({
      name: metadata.name,
      etag: metadata.etag,
      lastModified: metadata.lastModified,
      contentLength: metadata.contentLength,
    }),
  );
}

export function getMimitCircuitFingerprint(
  metadata: MimitDatasetMetadata,
): string {
  const strongFingerprint = getMimitResourceMetadataFingerprint(metadata.prices);
  if (strongFingerprint) return strongFingerprint;

  return sha256(
    JSON.stringify(
      {
        name: metadata.prices.name,
        url: metadata.prices.url,
        contentLength: metadata.prices.contentLength,
        contentType: metadata.prices.contentType,
      },
    ),
  );
}

function contentFingerprint(stations: string, prices: string): string {
  return sha256(
    JSON.stringify({
      stations,
      prices,
    }),
  );
}

function resourceWithContentFingerprint(
  metadata: MimitResourceMetadata,
  download: MimitResourceDownload,
): MimitResourceMetadata {
  return { ...metadata, contentFingerprint: sha256(download.text) };
}

function stationRefreshIsDue(
  active: ActiveDatasetSnapshot | undefined,
  now: Date,
): boolean {
  if (!active?.sourceMetadata?.stations.contentFingerprint) return true;
  const extractionTime = Date.parse(`${active.stationsExtractionDate}T00:00:00Z`);
  return (
    !Number.isFinite(extractionTime) ||
    now.getTime() - extractionTime >= STATION_REFRESH_INTERVAL_MS
  );
}

export function unavailablePricesRequireStationRefresh(
  unavailable: number,
  accepted: number,
): boolean {
  const total = unavailable + accepted;
  return (
    unavailable >= UNKNOWN_STATION_ABSOLUTE_THRESHOLD ||
    (unavailable >= UNKNOWN_STATION_RATIO_MINIMUM &&
      total > 0 &&
      unavailable / total >= UNKNOWN_STATION_RATIO_THRESHOLD)
  );
}

function combinedHeader(
  metadata: MimitDatasetMetadata,
  key: "etag" | "lastModified",
): string | null {
  const stations = metadata.stations[key];
  const prices = metadata.prices[key];
  if (!stations && !prices) return null;
  return `stations=${stations ?? ""};prices=${prices ?? ""}`;
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown import error";
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, "postgresql://[redacted]@")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 500);
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += INSERT_CHUNK_SIZE) {
    result.push(values.slice(index, index + INSERT_CHUNK_SIZE));
  }
  return result;
}

async function inActivationTransaction<T>(
  sql: postgres.Sql | postgres.TransactionSql,
  callback: (transaction: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  if ("begin" in sql) return (await sql.begin(callback)) as T;
  return (await sql.savepoint(callback)) as T;
}

async function insertStations(
  transaction: postgres.TransactionSql,
  datasetId: string,
  dataset: FuelRadarDataset,
): Promise<void> {
  for (const chunk of chunks(dataset.stations)) {
    await transaction`
      insert into fuelradar.stations (
        dataset_id, id, operator, brand, station_type, name, address, city,
        province, location
      )
      select
        ${datasetId}::bigint,
        record.id,
        record.operator,
        record.brand,
        record.station_type,
        record.name,
        record.address,
        record.city,
        record.province,
        extensions.ST_SetSRID(
          extensions.ST_MakePoint(record.longitude, record.latitude),
          4326
        )
      from jsonb_to_recordset(${transaction.json(
        chunk.map((station) => ({
          id: station.id,
          operator: station.operator,
          brand: station.brand,
          station_type: station.stationType,
          name: station.name,
          address: station.address,
          city: station.city,
          province: station.province,
          longitude: station.longitude,
          latitude: station.latitude,
        })),
      )}) as record(
        id text,
        operator text,
        brand text,
        station_type text,
        name text,
        address text,
        city text,
        province text,
        longitude double precision,
        latitude double precision
      )
    `;
  }
}

async function copyStations(
  transaction: postgres.TransactionSql,
  sourceDatasetId: string,
  targetDatasetId: string,
): Promise<void> {
  await transaction`
    insert into fuelradar.stations (
      dataset_id, id, operator, brand, station_type, name, address, city,
      province, location
    )
    select
      ${targetDatasetId}::bigint, id, operator, brand, station_type, name,
      address, city, province, location
    from fuelradar.stations
    where dataset_id = ${sourceDatasetId}::bigint
  `;
}

async function insertPrices(
  transaction: postgres.TransactionSql,
  datasetId: string,
  dataset: FuelRadarDataset,
): Promise<void> {
  for (const chunk of chunks(dataset.prices)) {
    await transaction`
      insert into fuelradar.prices (
        dataset_id, station_id, fuel_type, service_mode, price, communicated_at
      )
      select
        ${datasetId}::bigint,
        record.station_id,
        record.fuel_type::fuelradar.fuel_type,
        record.service_mode::fuelradar.service_mode,
        record.price,
        record.communicated_at
      from jsonb_to_recordset(${transaction.json(
        chunk.map((price) => ({
          station_id: price.stationId,
          fuel_type: price.fuelType,
          service_mode: price.serviceMode,
          price: price.price,
          communicated_at: price.communicatedAt,
        })),
      )}) as record(
        station_id text,
        fuel_type text,
        service_mode text,
        price numeric,
        communicated_at timestamp
      )
    `;
  }
}

async function finishSkippedRun(input: {
  sql: postgres.Sql | postgres.TransactionSql;
  runId: string;
  datasetId: string | null;
  startedAtMs: number;
  now: () => Date;
  metadata: MimitDatasetMetadata;
  metadataFingerprint: string | null;
  sourceFingerprint?: string;
}): Promise<MimitImportResult> {
  const finishedAt = input.now();
  const durationMs = boundedDurationMs(
    input.startedAtMs,
    finishedAt.getTime(),
  );
  const reason = input.sourceFingerprint
    ? ("content-unchanged" as const)
    : ("metadata-unchanged" as const);

  const [updated] = await input.sql<{ id: string }[]>`
    update fuelradar.import_runs
    set status = 'skipped',
        finished_at = ${finishedAt},
        duration_ms = ${durationMs},
        dataset_id = ${input.datasetId}::bigint,
        source_etag = ${combinedHeader(input.metadata, "etag")},
        source_last_modified = ${combinedHeader(input.metadata, "lastModified")},
        source_fingerprint = ${input.sourceFingerprint ?? null},
        metadata_fingerprint = coalesce(
          ${input.metadataFingerprint},
          metadata_fingerprint
        ),
        source_metadata = ${input.sql.json(input.metadata)}
    where id = ${input.runId}::bigint and status = 'running'
    returning id
  `;
  if (!updated) throw new MimitImportClaimLostError();

  return {
    runId: input.runId,
    datasetId: input.datasetId,
    status: "skipped",
    stationCount: 0,
    priceCount: 0,
    durationMs,
    reason,
  };
}

export async function runMimitImport(
  dependencies: MimitImportDependencies,
): Promise<MimitImportResult> {
  const now = dependencies.now ?? (() => new Date());
  const startedAt = dependencies.claimedRun?.startedAt ?? now();
  const [createdRun] = dependencies.claimedRun
    ? [dependencies.claimedRun]
    : await dependencies.sql<{ id: string }[]>`
        insert into fuelradar.import_runs (status, started_at)
        values ('running', ${startedAt})
        on conflict (status) where status = 'running' do nothing
        returning id
      `;
  const run = createdRun;

  if (!run) {
    const finishedAt = now();
    const durationMs = boundedDurationMs(
      startedAt.getTime(),
      finishedAt.getTime(),
    );
    const [skippedRun] = await dependencies.sql<{ id: string }[]>`
      insert into fuelradar.import_runs (
        status, started_at, finished_at, duration_ms, error_message
      ) values (
        'skipped', ${startedAt}, ${finishedAt}, ${durationMs},
        'Import skipped because another run is active.'
      )
      returning id
    `;
    if (!skippedRun) throw new Error("Unable to record the skipped MIMIT import.");
    return {
      runId: skippedRun.id,
      datasetId: null,
      status: "skipped",
      stationCount: 0,
      priceCount: 0,
      durationMs,
      reason: "already-running",
    };
  }

  try {
    const observedMetadata = await dependencies.fetchMetadata();
    const observedMetadataHash = getMimitMetadataFingerprint(observedMetadata);

    const [metadataUpdated] = await dependencies.sql<{ id: string }[]>`
      update fuelradar.import_runs
      set source_etag = ${combinedHeader(observedMetadata, "etag")},
          source_last_modified = ${combinedHeader(observedMetadata, "lastModified")},
          metadata_fingerprint = coalesce(
            ${dependencies.claimedRun ? null : observedMetadataHash},
            metadata_fingerprint
          ),
          source_metadata = ${dependencies.sql.json(observedMetadata)}
      where id = ${run.id}::bigint and status = 'running'
      returning id
    `;
    if (!metadataUpdated) throw new MimitImportClaimLostError();

    const [active] = await dependencies.sql<ActiveDatasetSnapshot[]>`
      select
        id,
        stations_extraction_date::text as "stationsExtractionDate",
        station_count as "stationCount",
        source_metadata as "sourceMetadata"
      from fuelradar.datasets
      where is_active
      limit 1
    `;
    const refreshStations = stationRefreshIsDue(active, startedAt);
    const currentPriceMetadataHash = getMimitResourceMetadataFingerprint(
      observedMetadata.prices,
    );
    const activePriceMetadataHash = active?.sourceMetadata
      ? getMimitResourceMetadataFingerprint(active.sourceMetadata.prices)
      : null;

    if (
      !refreshStations &&
      currentPriceMetadataHash &&
      currentPriceMetadataHash === activePriceMetadataHash
    ) {
      return finishSkippedRun({
        sql: dependencies.sql,
        runId: run.id,
        datasetId: active?.id ?? null,
        startedAtMs: startedAt.getTime(),
        now,
        metadata: observedMetadata,
        metadataFingerprint: observedMetadataHash,
      });
    }

    let stationsDownload: MimitResourceDownload | undefined;
    let pricesDownload: MimitResourceDownload;
    if (refreshStations) {
      [stationsDownload, pricesDownload] = await Promise.all([
        dependencies.downloadStations(),
        dependencies.downloadPrices(),
      ]);
    } else {
      pricesDownload = await dependencies.downloadPrices();
    }
    let stationsRefreshed = Boolean(stationsDownload);
    let reusedDatasetId: string | null = null;
    let parsed: {
      dataset: FuelRadarDataset;
      diagnostics: MimitDatasetDiagnostics;
    };

    if (stationsDownload) {
      parsed = parseMimitDataset({
        stationsText: stationsDownload.text,
        pricesText: pricesDownload.text,
      });
    } else {
      if (!active?.sourceMetadata?.stations.contentFingerprint) {
        throw new Error("The active station snapshot cannot be reused safely.");
      }
      const stationRows = await dependencies.sql<{ id: string }[]>`
        select id
        from fuelradar.stations
        where dataset_id = ${active.id}::bigint
      `;
      if (stationRows.length !== active.stationCount) {
        throw new Error("The active station snapshot count is inconsistent.");
      }
      const parsedPrices = parseMimitPricesResource(
        pricesDownload.text,
        new Set(stationRows.map(({ id }) => id)),
      );
      if (active.stationsExtractionDate > parsedPrices.extractionDate) {
        throw new Error(
          "The price extraction predates the active station snapshot.",
        );
      }

      if (
        unavailablePricesRequireStationRefresh(
          parsedPrices.skippedPrices.stationUnavailable,
          parsedPrices.prices.length,
        )
      ) {
        stationsDownload = await dependencies.downloadStations();
        stationsRefreshed = true;
        parsed = parseMimitDataset({
          stationsText: stationsDownload.text,
          pricesText: pricesDownload.text,
        });
      } else {
        reusedDatasetId = active.id;
        parsed = {
          dataset: {
            extractionDate: parsedPrices.extractionDate,
            metadata: {
              stationsExtractionDate: active.stationsExtractionDate,
              pricesExtractionDate: parsedPrices.extractionDate,
            },
            stations: [],
            prices: parsedPrices.prices,
          },
          diagnostics: {
            recoveredRows: { stations: 0, prices: parsedPrices.recoveredRows },
            skippedStations: {
              missingId: 0,
              invalidId: 0,
              invalidCoordinates: 0,
            },
            skippedPrices: parsedPrices.skippedPrices,
          },
        };
      }
    }

    const stationCount = stationsRefreshed
      ? parsed.dataset.stations.length
      : active?.stationCount ?? 0;
    const effectiveMetadata: MimitDatasetMetadata = {
      stations: stationsDownload
        ? resourceWithContentFingerprint(
            observedMetadata.stations,
            stationsDownload,
          )
        : active!.sourceMetadata!.stations,
      prices: resourceWithContentFingerprint(
        observedMetadata.prices,
        pricesDownload,
      ),
    };
    const metadataHash = getMimitMetadataFingerprint(effectiveMetadata);
    const sourceHash = contentFingerprint(
      effectiveMetadata.stations.contentFingerprint!,
      effectiveMetadata.prices.contentFingerprint!,
    );

    const [contentUpdated] = await dependencies.sql<{ id: string }[]>`
      update fuelradar.import_runs
      set source_fingerprint = ${sourceHash},
          metadata_fingerprint = coalesce(
            ${dependencies.claimedRun ? null : metadataHash},
            metadata_fingerprint
          ),
          source_metadata = ${dependencies.sql.json(effectiveMetadata)},
          station_count = ${stationCount},
          price_count = ${parsed.dataset.prices.length},
          diagnostics = ${dependencies.sql.json(parsed.diagnostics)}
      where id = ${run.id}::bigint and status = 'running'
      returning id
    `;
    if (!contentUpdated) throw new MimitImportClaimLostError();

    return await inActivationTransaction(dependencies.sql, async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(hashtextextended(${IMPORT_LOCK_KEY}, 0))
      `;

      if (dependencies.claimedRun) {
        const [activeClaim] = await transaction<{ id: string }[]>`
          select id
          from fuelradar.import_runs
          where id = ${run.id}::bigint and status = 'running'
          for update
        `;
        if (!activeClaim) throw new MimitImportClaimLostError();
      }

      const [unchanged] = await transaction<{ id: string }[]>`
        select id
        from fuelradar.datasets
        where is_active and source_fingerprint = ${sourceHash}
        limit 1
      `;
      if (unchanged) {
        await transaction`
          update fuelradar.datasets
          set source_etag = ${combinedHeader(effectiveMetadata, "etag")},
              source_last_modified = ${combinedHeader(
                effectiveMetadata,
                "lastModified",
              )},
              metadata_fingerprint = ${metadataHash},
              source_metadata = ${transaction.json(effectiveMetadata)}
          where id = ${unchanged.id}::bigint and is_active
        `;
        return finishSkippedRun({
          sql: transaction,
          runId: run.id,
          datasetId: unchanged.id,
          startedAtMs: startedAt.getTime(),
          now,
          metadata: effectiveMetadata,
          metadataFingerprint: metadataHash,
          sourceFingerprint: sourceHash,
        });
      }

      const dataset = parsed.dataset;
      if (reusedDatasetId) {
        const [stillActive] = await transaction<{ id: string }[]>`
          select id
          from fuelradar.datasets
          where is_active and id = ${reusedDatasetId}::bigint
          for update
        `;
        if (!stillActive) throw new MimitImportClaimLostError();
      }

      const duplicateSnapshots = dependencies.pruneHistoricalDatasets === false
        ? []
        : await transaction<
            { station_count: number; price_count: number }[]
          >`
            delete from fuelradar.datasets
            where not is_active and source_fingerprint = ${sourceHash}
            returning station_count, price_count
          `;
      const [created] = await transaction<{ id: string }[]>`
        insert into fuelradar.datasets (
          extraction_date,
          stations_extraction_date,
          prices_extraction_date,
          source_etag,
          source_last_modified,
          source_fingerprint,
          metadata_fingerprint,
          source_metadata,
          station_count,
          price_count
        ) values (
          ${dataset.extractionDate}::date,
          ${dataset.metadata.stationsExtractionDate}::date,
          ${dataset.metadata.pricesExtractionDate}::date,
          ${combinedHeader(effectiveMetadata, "etag")},
          ${combinedHeader(effectiveMetadata, "lastModified")},
          ${sourceHash},
          ${metadataHash},
          ${transaction.json(effectiveMetadata)},
          ${stationCount},
          ${dataset.prices.length}
        )
        returning id
      `;
      if (!created) throw new Error("Unable to create the MIMIT dataset.");

      if (reusedDatasetId) {
        await copyStations(transaction, reusedDatasetId, created.id);
      } else {
        await insertStations(transaction, created.id, dataset);
      }
      await insertPrices(transaction, created.id, dataset);

      const [insertedCounts] = await transaction<
        { station_count: number; price_count: number }[]
      >`
        select
          (select count(*)::integer from fuelradar.stations
            where dataset_id = ${created.id}::bigint) as station_count,
          (select count(*)::integer from fuelradar.prices
            where dataset_id = ${created.id}::bigint) as price_count
      `;
      if (
        insertedCounts?.station_count !== stationCount ||
        insertedCounts.price_count !== dataset.prices.length
      ) {
        throw new Error("The staged MIMIT dataset count is inconsistent.");
      }
      await dependencies.beforeActivation?.(created.id);

      await transaction`
        update fuelradar.datasets
        set is_active = false
        where is_active
      `;
      await transaction`
        update fuelradar.datasets
        set is_active = true, activated_at = ${now()}
        where id = ${created.id}::bigint
      `;
      await dependencies.afterActivation?.(created.id);

      const retiredSnapshots = dependencies.pruneHistoricalDatasets === false
        ? []
        : await transaction<
            { station_count: number; price_count: number }[]
          >`
            delete from fuelradar.datasets
            where id <> ${created.id}::bigint
            returning station_count, price_count
          `;
      const pruned = [...duplicateSnapshots, ...retiredSnapshots];

      const [retained] = await transaction<
        { dataset_count: number; active_count: number }[]
      >`
        select
          count(*)::integer as dataset_count,
          count(*) filter (where is_active)::integer as active_count
        from fuelradar.datasets
      `;
      if (
        retained?.active_count !== 1 ||
        (dependencies.pruneHistoricalDatasets !== false &&
          retained.dataset_count !== 1)
      ) {
        throw new Error(
          `The active-only retention invariant failed: datasets=${retained?.dataset_count ?? "missing"}, active=${retained?.active_count ?? "missing"}.`,
        );
      }
      const finishedAt = now();
      const durationMs = boundedDurationMs(
        startedAt.getTime(),
        finishedAt.getTime(),
      );
      const [succeeded] = await transaction<{ id: string }[]>`
        update fuelradar.import_runs
        set status = 'succeeded',
            finished_at = ${finishedAt},
            duration_ms = ${durationMs},
            dataset_id = ${created.id}::bigint,
            source_etag = ${combinedHeader(effectiveMetadata, "etag")},
            source_last_modified = ${combinedHeader(effectiveMetadata, "lastModified")},
            source_fingerprint = ${sourceHash},
            metadata_fingerprint = ${metadataHash},
            source_metadata = ${transaction.json(effectiveMetadata)},
            station_count = ${stationCount},
            price_count = ${dataset.prices.length},
            diagnostics = ${transaction.json(parsed.diagnostics)}
        where id = ${run.id}::bigint and status = 'running'
        returning id
      `;
      if (!succeeded) throw new MimitImportClaimLostError();

      return {
        runId: run.id,
        datasetId: created.id,
        status: "succeeded" as const,
        stationCount,
        priceCount: dataset.prices.length,
        durationMs,
        maintenance: {
          stationsRefreshed,
          prunedDatasetCount: pruned.length,
          prunedStationCount: pruned.reduce(
            (total, row) => total + row.station_count,
            0,
          ),
          prunedPriceCount: pruned.reduce(
            (total, row) => total + row.price_count,
            0,
          ),
        },
      };
    });
  } catch (error) {
    const finishedAt = now();
    const [failed] = await dependencies.sql<{ id: string }[]>`
      update fuelradar.import_runs
      set status = 'failed',
          finished_at = ${finishedAt},
          duration_ms = ${boundedDurationMs(
            startedAt.getTime(),
            finishedAt.getTime(),
          )},
          error_message = ${safeErrorMessage(error)}
      where id = ${run.id}::bigint and status = 'running'
      returning id
    `;
    if (!failed && !(error instanceof MimitImportClaimLostError)) {
      throw new MimitImportClaimLostError();
    }
    throw error;
  }
}
