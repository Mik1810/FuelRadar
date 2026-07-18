import { createHash } from "node:crypto";

import type postgres from "postgres";

import type { FuelRadarDataset } from "@/domain/dataset";
import {
  parseMimitDataset,
} from "@/domain/mimit/dataset";
import type {
  MimitDatasetMetadata,
  MimitResourceDownload,
} from "@/domain/mimit/source";

const IMPORT_LOCK_KEY = "fuelradar:mimit-import:v1";
const INSERT_CHUNK_SIZE = 2_000;

export type MimitImportStatus = "succeeded" | "skipped";

export type MimitImportResult = {
  runId: string;
  datasetId: string | null;
  status: MimitImportStatus;
  stationCount: number;
  priceCount: number;
  durationMs: number;
  reason?: "metadata-unchanged" | "content-unchanged";
};

export type MimitImportDependencies = {
  sql: postgres.Sql;
  fetchMetadata: () => Promise<MimitDatasetMetadata>;
  downloadDataset: () => Promise<{
    stations: MimitResourceDownload;
    prices: MimitResourceDownload;
  }>;
  now?: () => Date;
  beforeActivation?: (datasetId: string) => Promise<void>;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function metadataFingerprint(metadata: MimitDatasetMetadata): string | null {
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

function contentFingerprint(download: {
  stations: MimitResourceDownload;
  prices: MimitResourceDownload;
}): string {
  return sha256(
    JSON.stringify({
      stations: sha256(download.stations.text),
      prices: sha256(download.prices.text),
    }),
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
  const durationMs = Math.max(0, finishedAt.getTime() - input.startedAtMs);
  const reason = input.sourceFingerprint
    ? ("content-unchanged" as const)
    : ("metadata-unchanged" as const);

  await input.sql`
    update fuelradar.import_runs
    set status = 'skipped',
        finished_at = ${finishedAt},
        duration_ms = ${durationMs},
        dataset_id = ${input.datasetId}::bigint,
        source_etag = ${combinedHeader(input.metadata, "etag")},
        source_last_modified = ${combinedHeader(input.metadata, "lastModified")},
        source_fingerprint = ${input.sourceFingerprint ?? null},
        metadata_fingerprint = ${input.metadataFingerprint},
        source_metadata = ${input.sql.json(input.metadata)}
    where id = ${input.runId}::bigint
  `;

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
  const startedAt = now();
  const [run] = await dependencies.sql<{ id: string }[]>`
    insert into fuelradar.import_runs (status, started_at)
    values ('running', ${startedAt})
    returning id
  `;

  if (!run) throw new Error("Unable to create the MIMIT import run.");

  try {
    const metadata = await dependencies.fetchMetadata();
    const metadataHash = metadataFingerprint(metadata);

    await dependencies.sql`
      update fuelradar.import_runs
      set source_etag = ${combinedHeader(metadata, "etag")},
          source_last_modified = ${combinedHeader(metadata, "lastModified")},
          metadata_fingerprint = ${metadataHash},
          source_metadata = ${dependencies.sql.json(metadata)}
      where id = ${run.id}::bigint
    `;

    if (metadataHash) {
      const [unchanged] = await dependencies.sql<{ id: string }[]>`
        select id
        from fuelradar.datasets
        where is_active and metadata_fingerprint = ${metadataHash}
        limit 1
      `;
      if (unchanged) {
        return finishSkippedRun({
          sql: dependencies.sql,
          runId: run.id,
          datasetId: unchanged.id,
          startedAtMs: startedAt.getTime(),
          now,
          metadata,
          metadataFingerprint: metadataHash,
        });
      }
    }

    const download = await dependencies.downloadDataset();
    const parsed = parseMimitDataset({
      stationsText: download.stations.text,
      pricesText: download.prices.text,
    });
    const sourceHash = contentFingerprint(download);

    await dependencies.sql`
      update fuelradar.import_runs
      set source_fingerprint = ${sourceHash},
          station_count = ${parsed.dataset.stations.length},
          price_count = ${parsed.dataset.prices.length},
          diagnostics = ${dependencies.sql.json(parsed.diagnostics)}
      where id = ${run.id}::bigint
    `;

    return await dependencies.sql.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(hashtextextended(${IMPORT_LOCK_KEY}, 0))
      `;

      const [unchanged] = await transaction<{ id: string }[]>`
        select id
        from fuelradar.datasets
        where source_fingerprint = ${sourceHash}
        limit 1
      `;
      if (unchanged) {
        return finishSkippedRun({
          sql: transaction,
          runId: run.id,
          datasetId: unchanged.id,
          startedAtMs: startedAt.getTime(),
          now,
          metadata,
          metadataFingerprint: metadataHash,
          sourceFingerprint: sourceHash,
        });
      }

      const dataset = parsed.dataset;
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
          ${combinedHeader(metadata, "etag")},
          ${combinedHeader(metadata, "lastModified")},
          ${sourceHash},
          ${metadataHash},
          ${transaction.json(metadata)},
          ${dataset.stations.length},
          ${dataset.prices.length}
        )
        returning id
      `;
      if (!created) throw new Error("Unable to create the MIMIT dataset.");

      await insertStations(transaction, created.id, dataset);
      await insertPrices(transaction, created.id, dataset);
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

      const finishedAt = now();
      const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      await transaction`
        update fuelradar.import_runs
        set status = 'succeeded',
            finished_at = ${finishedAt},
            duration_ms = ${durationMs},
            dataset_id = ${created.id}::bigint,
            source_etag = ${combinedHeader(metadata, "etag")},
            source_last_modified = ${combinedHeader(metadata, "lastModified")},
            source_fingerprint = ${sourceHash},
            metadata_fingerprint = ${metadataHash},
            source_metadata = ${transaction.json(metadata)},
            station_count = ${dataset.stations.length},
            price_count = ${dataset.prices.length},
            diagnostics = ${transaction.json(parsed.diagnostics)}
        where id = ${run.id}::bigint
      `;

      return {
        runId: run.id,
        datasetId: created.id,
        status: "succeeded" as const,
        stationCount: dataset.stations.length,
        priceCount: dataset.prices.length,
        durationMs,
      };
    });
  } catch (error) {
    const finishedAt = now();
    await dependencies.sql`
      update fuelradar.import_runs
      set status = 'failed',
          finished_at = ${finishedAt},
          duration_ms = ${Math.max(0, finishedAt.getTime() - startedAt.getTime())},
          error_message = ${safeErrorMessage(error)}
      where id = ${run.id}::bigint
    `;
    throw error;
  }
}
