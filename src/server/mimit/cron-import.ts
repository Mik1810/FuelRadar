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
const MAX_DATABASE_ERROR_NODES = 16;

export type MimitCronDatabaseUnavailableReason =
  | "client_initialization_failed"
  | "pooler_circuit_open"
  | "pooler_tenant_not_found"
  | "authentication_failed"
  | "connection_timeout"
  | "dns_failed"
  | "connection_refused"
  | "permission_denied"
  | "database_not_found"
  | "connection_reset"
  | "network_unreachable"
  | "connection_failure"
  | "resource_exhausted"
  | "server_unavailable"
  | "schema_unavailable"
  | "unsupported_database_feature"
  | "unknown";

const DATABASE_ERROR_REASONS = new Map<
  string,
  MimitCronDatabaseUnavailableReason
>([
  ["28P01", "authentication_failed"],
  ["28000", "authentication_failed"],
  ["ETIMEDOUT", "connection_timeout"],
  ["CONNECT_TIMEOUT", "connection_timeout"],
  ["UND_ERR_CONNECT_TIMEOUT", "connection_timeout"],
  ["ENOTFOUND", "dns_failed"],
  ["EAI_AGAIN", "dns_failed"],
  ["ECONNREFUSED", "connection_refused"],
  ["42501", "permission_denied"],
  ["3D000", "database_not_found"],
  ["ECONNRESET", "connection_reset"],
  ["ENETUNREACH", "network_unreachable"],
  ["EHOSTUNREACH", "network_unreachable"],
]);

const DATABASE_DIAGNOSTIC_CODES = [
  "28P01",
  "28000",
  "ETIMEDOUT",
  "CONNECT_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "42501",
  "3D000",
  "ECONNRESET",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "42P01",
  "42883",
  "XX000",
] as const;

export type MimitCronDatabaseDiagnosticCode =
  (typeof DATABASE_DIAGNOSTIC_CODES)[number];

const DATABASE_DIAGNOSTIC_CODE_ALLOWLIST = new Set<string>(
  DATABASE_DIAGNOSTIC_CODES,
);

function readErrorField(
  error: unknown,
  field: "cause" | "code" | "errors" | "message",
): unknown {
  if ((typeof error !== "object" && typeof error !== "function") || !error) {
    return undefined;
  }
  try {
    if (!Object.prototype.hasOwnProperty.call(error, field)) return undefined;
    return Reflect.get(error, field);
  } catch {
    return undefined;
  }
}

function isErrorObject(value: unknown): value is object | ((...args: never[]) => unknown) {
  return (
    value !== null && (typeof value === "object" || typeof value === "function")
  );
}

function readArrayError(errors: unknown[], index: number): unknown {
  try {
    return errors[index];
  } catch {
    return undefined;
  }
}

function boundedArrayLength(errors: unknown[]): number {
  try {
    return Math.min(errors.length, MAX_DATABASE_ERROR_NODES);
  } catch {
    return 0;
  }
}

function reasonFromDatabaseCode(
  rawCode: string,
): MimitCronDatabaseUnavailableReason | undefined {
  if (rawCode.length > 64) return undefined;
  const code = rawCode.toUpperCase();
  const specificReason = DATABASE_ERROR_REASONS.get(code);
  if (specificReason) return specificReason;

  if (code === "42P01") return "schema_unavailable";
  if (code === "42883") return "unsupported_database_feature";
  if (/^08[A-Z0-9]{3}$/.test(code)) return "connection_failure";
  if (/^53[A-Z0-9]{3}$/.test(code)) return "resource_exhausted";
  if (/^(?:57P[A-Z0-9]{2}|58[A-Z0-9]{3})$/.test(code)) {
    return "server_unavailable";
  }
  return undefined;
}

function reasonFromDatabaseMessage(
  rawMessage: string,
): MimitCronDatabaseUnavailableReason | undefined {
  const message = rawMessage.slice(0, 512).toLowerCase();
  if (
    message.includes("circuit breaker") ||
    message.includes("ecircuitbreaker")
  ) {
    return "pooler_circuit_open";
  }
  if (
    message.includes("tenant or user not found") ||
    message.includes("tenant not found") ||
    message.includes("(enotfound) tenant/user ")
  ) {
    return "pooler_tenant_not_found";
  }
  if (
    message.includes("invalid scram server-final-message") ||
    message.includes("invalid client signature") ||
    message.includes("sasl")
  ) {
    return "authentication_failed";
  }
  if (
    message.includes("max client connections") ||
    message.includes("too many clients")
  ) {
    return "resource_exhausted";
  }
  if (
    message.includes("connection terminated unexpectedly") ||
    message.includes("db_termination")
  ) {
    return "server_unavailable";
  }
  if (message.includes("connect_timeout") || message.includes("timed out")) {
    return "connection_timeout";
  }
  if (message.includes("enotfound") || message.includes("getaddrinfo")) {
    return "dns_failed";
  }
  if (message.includes("authentication") || message.includes("password")) {
    return "authentication_failed";
  }
  if (message.includes("refused")) return "connection_refused";
  if (message.includes("reset")) return "connection_reset";
  return undefined;
}

type MimitCronDatabaseDiagnostics = {
  diagnosticCode: MimitCronDatabaseDiagnosticCode | null;
  reason: MimitCronDatabaseUnavailableReason;
};

function inspectMimitCronDatabaseError(
  error: unknown,
): MimitCronDatabaseDiagnostics {
  if (!isErrorObject(error)) {
    return { diagnosticCode: null, reason: "unknown" };
  }

  const queue: unknown[] = [error];
  const scheduled = new Set<unknown>([error]);
  let diagnosticCode: MimitCronDatabaseDiagnosticCode | null = null;
  let messageReason: MimitCronDatabaseUnavailableReason | undefined;

  for (
    let index = 0;
    index < queue.length && index < MAX_DATABASE_ERROR_NODES;
    index += 1
  ) {
    const current = queue[index];

    const rawCode = readErrorField(current, "code");
    if (typeof rawCode === "string" && rawCode.length <= 64) {
      const code = rawCode.toUpperCase();
      const allowedCode = DATABASE_DIAGNOSTIC_CODE_ALLOWLIST.has(code)
        ? (code as MimitCronDatabaseDiagnosticCode)
        : null;
      const reason = reasonFromDatabaseCode(code);
      if (reason) {
        return {
          diagnosticCode: allowedCode ?? diagnosticCode,
          reason,
        };
      }
      diagnosticCode ??= allowedCode;
    }
    const message = readErrorField(current, "message");
    if (!messageReason && typeof message === "string") {
      messageReason = reasonFromDatabaseMessage(message);
    }

    const schedule = (child: unknown) => {
      if (
        scheduled.size >= MAX_DATABASE_ERROR_NODES ||
        !isErrorObject(child) ||
        scheduled.has(child)
      ) {
        return;
      }
      scheduled.add(child);
      queue.push(child);
    };

    schedule(readErrorField(current, "cause"));

    const errors = readErrorField(current, "errors");
    let isErrorsArray = false;
    try {
      isErrorsArray = Array.isArray(errors);
    } catch {
      isErrorsArray = false;
    }
    if (isErrorsArray) {
      const children = errors as unknown[];
      const limit = boundedArrayLength(children);
      for (let childIndex = 0; childIndex < limit; childIndex += 1) {
        schedule(readArrayError(children, childIndex));
      }
    }
  }

  return {
    diagnosticCode,
    reason: messageReason ?? "unknown",
  };
}

export function classifyMimitCronDatabaseError(
  error: unknown,
): MimitCronDatabaseUnavailableReason {
  return inspectMimitCronDatabaseError(error).reason;
}

export class MimitCronConfigurationError extends Error {
  constructor(cause?: unknown) {
    super("MIMIT cron runtime configuration is unavailable.", { cause });
    this.name = "MimitCronConfigurationError";
  }
}

export class MimitCronDatabaseUnavailableError extends Error {
  readonly diagnosticCode: MimitCronDatabaseDiagnosticCode | null;
  readonly reason: MimitCronDatabaseUnavailableReason;

  constructor(cause?: unknown, reason?: MimitCronDatabaseUnavailableReason) {
    super("MIMIT cron database is unavailable before the import claim.", {
      cause,
    });
    const diagnostics = inspectMimitCronDatabaseError(cause);
    this.name = "MimitCronDatabaseUnavailableError";
    this.diagnosticCode = diagnostics.diagnosticCode;
    this.reason = reason ?? diagnostics.reason;
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
