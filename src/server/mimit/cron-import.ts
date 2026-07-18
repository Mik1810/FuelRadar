import type postgres from "postgres";

import type {
  MimitDatasetMetadata,
  MimitResourceDownload,
} from "@/domain/mimit/source";
import {
  getMimitCircuitFingerprint,
  IMPORT_LOCK_KEY,
  MimitImportClaimLostError,
  runMimitImport,
  type MimitImportResult,
} from "@/server/mimit/importer";

const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;
const CIRCUIT_BREAKER_FAILURES = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 24 * 60 * 60 * 1_000;
const RUN_LEASE_MS = 15 * 60 * 1_000;

export class MimitCronConfigurationError extends Error {
  constructor(cause?: unknown) {
    super("MIMIT cron runtime configuration is unavailable.", { cause });
    this.name = "MimitCronConfigurationError";
  }
}

export class MimitCronDatabaseUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("MIMIT cron database is unavailable before the import claim.", {
      cause,
    });
    this.name = "MimitCronDatabaseUnavailableError";
  }
}

type MimitDownload = {
  stations: MimitResourceDownload;
  prices: MimitResourceDownload;
};

type ClaimedRun = { id: string; startedAt: Date };

export type MimitCronResult =
  | MimitImportResult
  | {
      status: "skipped";
      runId: string | null;
      datasetId: null;
      stationCount: 0;
      priceCount: 0;
      durationMs: number;
      reason: "already-running" | "circuit-open";
    };

export type MimitCronDependencies = {
  sql: postgres.Sql;
  fetchMetadata: () => Promise<MimitDatasetMetadata>;
  downloadDataset: () => Promise<MimitDownload>;
  isTransientFetchError: (error: unknown) => boolean;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTransientFetchRetry<T>(
  operation: () => Promise<T>,
  isTransient: (error: unknown) => boolean,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_FETCH_ATTEMPTS || !isTransient(error)) throw error;
      await sleep(RETRY_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

async function claimRun(
  sql: postgres.Sql,
  claimedAt: Date,
): Promise<ClaimedRun | null> {
  return (await sql.begin(async (transaction) => {
    const [lock] = await transaction<{ acquired: boolean }[]>`
      select pg_try_advisory_xact_lock(hashtextextended(${IMPORT_LOCK_KEY}, 0)) as acquired
    `;
    if (!lock?.acquired) return null;

    const staleBefore = new Date(claimedAt.getTime() - RUN_LEASE_MS);
    await transaction`
      update fuelradar.import_runs
      set status = 'failed',
          finished_at = ${claimedAt},
          duration_ms = least(
            2147483647,
            greatest(
              0,
              floor(extract(epoch from (${claimedAt} - started_at)) * 1000)
            )
          )::integer,
          error_message = 'Import lease expired before completion.'
      where status = 'running' and started_at < ${staleBefore}
    `;

    const [active] = await transaction<{ id: string }[]>`
      select id
      from fuelradar.import_runs
      where status = 'running'
      limit 1
    `;
    if (active) return null;

    const [run] = await transaction<{ id: string }[]>`
      insert into fuelradar.import_runs (status, started_at)
      values ('running', ${claimedAt})
      returning id
    `;
    if (!run) throw new Error("Unable to claim the MIMIT import run.");
    return { id: run.id, startedAt: claimedAt };
  })) as ClaimedRun | null;
}

async function failClaim(input: {
  sql: postgres.Sql;
  claim: ClaimedRun;
  finishedAt: Date;
}): Promise<void> {
  const [failed] = await input.sql<{ id: string }[]>`
    update fuelradar.import_runs
    set status = 'failed',
        finished_at = ${input.finishedAt},
        duration_ms = ${Math.max(
          0,
          input.finishedAt.getTime() - input.claim.startedAt.getTime(),
        )},
        error_message = 'MIMIT import failed before dataset processing.'
    where id = ${input.claim.id}::bigint and status = 'running'
    returning id
  `;
  if (!failed) throw new MimitImportClaimLostError();
}

async function circuitIsOpen(input: {
  sql: postgres.Sql;
  metadataFingerprint: string;
  now: Date;
}): Promise<boolean> {
  const [result] = await input.sql<{ failure_count: number }[]>`
    select count(*)::integer as failure_count
    from fuelradar.import_runs
    where status = 'failed'
      and metadata_fingerprint = ${input.metadataFingerprint}
      and finished_at >= ${new Date(
        input.now.getTime() - CIRCUIT_BREAKER_COOLDOWN_MS,
      )}
  `;
  return (result?.failure_count ?? 0) >= CIRCUIT_BREAKER_FAILURES;
}

async function finishCircuitOpen(input: {
  sql: postgres.Sql;
  claim: ClaimedRun;
  metadata: MimitDatasetMetadata;
  metadataFingerprint: string;
  finishedAt: Date;
}): Promise<MimitCronResult> {
  const durationMs = Math.max(
    0,
    input.finishedAt.getTime() - input.claim.startedAt.getTime(),
  );
  const [finished] = await input.sql<{ id: string }[]>`
    update fuelradar.import_runs
    set status = 'skipped',
        finished_at = ${input.finishedAt},
        duration_ms = ${durationMs},
        metadata_fingerprint = ${input.metadataFingerprint},
        source_metadata = ${input.sql.json(input.metadata)},
        error_message = 'Circuit breaker open for repeatedly failed remote version.'
    where id = ${input.claim.id}::bigint and status = 'running'
    returning id
  `;
  if (!finished) throw new MimitImportClaimLostError();

  return {
    status: "skipped",
    runId: input.claim.id,
    datasetId: null,
    stationCount: 0,
    priceCount: 0,
    durationMs,
    reason: "circuit-open",
  };
}

export async function runMimitCronImport(
  dependencies: MimitCronDependencies,
): Promise<MimitCronResult> {
  const now = dependencies.now ?? (() => new Date());
  const startedAt = now();
  let claim: ClaimedRun | null = null;
  let importerStarted = false;
  try {
    try {
      claim = await claimRun(dependencies.sql, startedAt);
    } catch (error) {
      throw new MimitCronDatabaseUnavailableError(error);
    }
    if (!claim) {
      return {
        status: "skipped",
        runId: null,
        datasetId: null,
        stationCount: 0,
        priceCount: 0,
        durationMs: Math.max(0, now().getTime() - startedAt.getTime()),
        reason: "already-running",
      };
    }

    const sleep = dependencies.sleep ?? delay;
    const metadata = await withTransientFetchRetry(
      dependencies.fetchMetadata,
      dependencies.isTransientFetchError,
      sleep,
    );
    const metadataFingerprint = getMimitCircuitFingerprint(metadata);

    const [metadataUpdated] = await dependencies.sql<{ id: string }[]>`
      update fuelradar.import_runs
      set metadata_fingerprint = ${metadataFingerprint},
          source_metadata = ${dependencies.sql.json(metadata)}
      where id = ${claim.id}::bigint and status = 'running'
      returning id
    `;
    if (!metadataUpdated) throw new MimitImportClaimLostError();

    if (
      await circuitIsOpen({
        sql: dependencies.sql,
        metadataFingerprint,
        now: now(),
      })
    ) {
      return await finishCircuitOpen({
        sql: dependencies.sql,
        claim,
        metadata,
        metadataFingerprint,
        finishedAt: now(),
      });
    }

    importerStarted = true;
    return await runMimitImport({
      sql: dependencies.sql,
      fetchMetadata: async () => metadata,
      downloadDataset: () =>
        withTransientFetchRetry(
          dependencies.downloadDataset,
          dependencies.isTransientFetchError,
          sleep,
        ),
      claimedRun: claim,
      now,
    });
  } catch (error) {
    if (claim && !importerStarted) {
      await failClaim({ sql: dependencies.sql, claim, finishedAt: now() });
    }
    throw error;
  }
}
