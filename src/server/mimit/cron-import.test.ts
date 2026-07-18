import { describe, expect, test } from "bun:test";
import type postgres from "postgres";

import type { MimitDatasetMetadata } from "@/domain/mimit/source";
import {
  getMimitCircuitFingerprint,
  getMimitMetadataFingerprint,
  MimitImportClaimLostError,
  runMimitImport,
} from "@/server/mimit/importer";
import {
  classifyMimitCronDatabaseError,
  MimitCronDatabaseUnavailableError,
  runMimitCronImport,
} from "@/server/mimit/cron-import";

type QueryEvent = {
  text: string;
  values: unknown[];
};

type FakeSqlOptions = {
  lockAcquired?: boolean;
  activeRunId?: string;
  failureCount?: (fingerprint: string) => number;
  unchangedDatasetId?: string;
  loseClaimOnMetadataUpdate?: boolean;
  loseClaimBeforeActivation?: boolean;
};

function normalizeSql(strings: TemplateStringsArray): string {
  return strings.join("?").replace(/\s+/g, " ").trim();
}

function createFakeSql(options: FakeSqlOptions = {}) {
  const events: QueryEvent[] = [];
  let nextRunId = 1;
  let activeRunId = options.activeRunId;

  const query = async <T extends unknown[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T> => {
    const text = normalizeSql(strings);
    events.push({ text, values });

    if (text.includes("pg_try_advisory_xact_lock")) {
      return [{ acquired: options.lockAcquired ?? true }] as T;
    }
    if (text.includes("pg_advisory_xact_lock")) {
      return [] as unknown as T;
    }
    if (text.includes("error_message = 'Import lease expired")) {
      return [] as unknown as T;
    }
    if (
      text.includes("from fuelradar.import_runs") &&
      text.includes("for update")
    ) {
      if (options.loseClaimBeforeActivation) activeRunId = "replacement-run";
      const requestedId = values.find(
        (value): value is string => typeof value === "string" && value.startsWith("run-"),
      );
      return (requestedId && requestedId === activeRunId
        ? [{ id: requestedId }]
        : []) as T;
    }
    if (text.includes("where status = 'running'") && text.includes("select id")) {
      return (activeRunId ? [{ id: activeRunId }] : []) as T;
    }
    if (
      text.includes("insert into fuelradar.import_runs") &&
      text.includes("values ('running'")
    ) {
      activeRunId = `run-${nextRunId++}`;
      return [{ id: activeRunId }] as T;
    }
    if (text.includes("select count(*)::integer as failure_count")) {
      const fingerprint = values.find(
        (value): value is string => typeof value === "string" && value.length === 64,
      );
      return [
        { failure_count: options.failureCount?.(fingerprint ?? "") ?? 0 },
      ] as T;
    }
    if (
      text.includes("from fuelradar.datasets") &&
      text.includes("where is_active and metadata_fingerprint")
    ) {
      return (options.unchangedDatasetId
        ? [{ id: options.unchangedDatasetId }]
        : []) as T;
    }
    if (text.startsWith("update fuelradar.import_runs")) {
      if (
        options.loseClaimOnMetadataUpdate &&
        text.includes("set source_etag")
      ) {
        activeRunId = "replacement-run";
      }
      const requestedId = values.find(
        (value): value is string => typeof value === "string" && value.startsWith("run-"),
      );
      const updated = requestedId !== undefined && requestedId === activeRunId;
      if (
        updated &&
        (text.includes("status = 'failed'") || text.includes("status = 'skipped'") || text.includes("status = 'succeeded'"))
      ) {
        activeRunId = undefined;
      }
      return (text.includes("returning id") && updated
        ? [{ id: requestedId }]
        : []) as T;
    }

    throw new Error(`Unexpected SQL in test: ${text}`);
  };

  const sql = query as typeof query & {
    begin: <T>(
      callback: (transaction: postgres.TransactionSql) => Promise<T>,
    ) => Promise<T>;
    json: (value: unknown) => unknown;
  };
  sql.begin = async <T>(
    callback: (transaction: postgres.TransactionSql) => Promise<T>,
  ) => callback(sql as unknown as postgres.TransactionSql);
  sql.json = (value: unknown) => value;

  return { sql: sql as unknown as postgres.Sql, events };
}

function metadata(version: string | null): MimitDatasetMetadata {
  const resource = (name: "stations" | "prices") => ({
    name,
    url: `https://example.test/${name}.csv`,
    etag: version ? `\"${name}-${version}\"` : null,
    lastModified: version ? "Sat, 18 Jul 2026 12:00:00 GMT" : null,
    contentLength: name === "stations" ? 100 : 200,
    contentType: "text/csv",
    checkedAt: "2026-07-18T12:00:00.000Z",
  });
  return { stations: resource("stations"), prices: resource("prices") };
}

function neverDownload() {
  return async () => {
    throw new Error("download should not be called");
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("MIMIT cron import", () => {
  test("wraps a database failure before the claim is created", async () => {
    const databaseCause = new Error("database connection failed");
    let metadataCalls = 0;
    const sql = {
      begin: async () => {
        throw databaseCause;
      },
    } as unknown as postgres.Sql;

    try {
      await runMimitCronImport({
        sql,
        fetchMetadata: async () => {
          metadataCalls += 1;
          return metadata("unused");
        },
        downloadDataset: neverDownload(),
        isTransientFetchError: () => false,
      });
      throw new Error("Expected the cron import to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(MimitCronDatabaseUnavailableError);
      expect((error as Error & { cause?: unknown }).cause).toBe(databaseCause);
    }
    expect(metadataCalls).toBe(0);
  });

  test("returns already-running for an overlapping claimed run and cleans up its lease", async () => {
    const fake = createFakeSql({ failureCount: () => 3 });
    const metadataStarted = deferred<void>();
    const metadataResult = deferred<MimitDatasetMetadata>();
    const first = runMimitCronImport({
      sql: fake.sql,
      fetchMetadata: async () => {
        metadataStarted.resolve();
        return metadataResult.promise;
      },
      downloadDataset: neverDownload(),
      isTransientFetchError: () => false,
    });
    await metadataStarted.promise;

    const overlap = await runMimitCronImport({
      sql: fake.sql,
      fetchMetadata: async () => metadata("overlap"),
      downloadDataset: neverDownload(),
      isTransientFetchError: () => false,
    });
    expect(overlap.reason).toBe("already-running");
    expect(
      fake.events.filter(({ text }) => text.includes("pg_try_advisory")),
    ).toHaveLength(2);

    metadataResult.resolve(metadata("first"));
    expect((await first).reason).toBe("circuit-open");

    const after = await runMimitCronImport({
      sql: fake.sql,
      fetchMetadata: async () => metadata("after"),
      downloadDataset: neverDownload(),
      isTransientFetchError: () => false,
    });
    expect(after).toMatchObject({ reason: "circuit-open", runId: "run-2" });
  });

  test("does not claim when the advisory lock or an active lease blocks it", async () => {
    for (const options of [
      { lockAcquired: false },
      { lockAcquired: true, activeRunId: "active-run" },
    ]) {
      const fake = createFakeSql(options);
      let metadataCalls = 0;
      const result = await runMimitCronImport({
        sql: fake.sql,
        fetchMetadata: async () => {
          metadataCalls += 1;
          return metadata("unused");
        },
        downloadDataset: neverDownload(),
        isTransientFetchError: () => false,
      });

      expect(result.reason).toBe("already-running");
      expect(metadataCalls).toBe(0);
      expect(
        fake.events.some(({ text }) =>
          text.includes("insert into fuelradar.import_runs"),
        ),
      ).toBeFalse();
    }
  });

  test("retries transient metadata failures exactly three times with bounded backoff", async () => {
    const fake = createFakeSql();
    const transientError = new Error("temporary upstream failure");
    const sleeps: number[] = [];
    let attempts = 0;

    await expect(
      runMimitCronImport({
        sql: fake.sql,
        fetchMetadata: async () => {
          attempts += 1;
          throw transientError;
        },
        downloadDataset: neverDownload(),
        isTransientFetchError: (error) => error === transientError,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      }),
    ).rejects.toBe(transientError);

    expect(attempts).toBe(3);
    expect(sleeps).toEqual([250, 500]);
    expect(
      fake.events.some(
        ({ text }) =>
          text.includes("status = 'failed'") &&
          text.includes("MIMIT import failed before dataset processing"),
      ),
    ).toBeTrue();
  });

  test("does not retry a non-transient metadata failure and fails its claim", async () => {
    const fake = createFakeSql();
    const permanentError = new Error("invalid upstream response");
    let attempts = 0;
    let sleeps = 0;

    await expect(
      runMimitCronImport({
        sql: fake.sql,
        fetchMetadata: async () => {
          attempts += 1;
          throw permanentError;
        },
        downloadDataset: neverDownload(),
        isTransientFetchError: () => false,
        sleep: async () => {
          sleeps += 1;
        },
      }),
    ).rejects.toBe(permanentError);

    expect(permanentError).not.toBeInstanceOf(MimitCronDatabaseUnavailableError);

    expect(attempts).toBe(1);
    expect(sleeps).toBe(0);
    const failure = fake.events.find(({ text }) =>
      text.includes("MIMIT import failed before dataset processing"),
    );
    expect(failure).toBeDefined();
    expect(failure?.values).toContain("run-1");
    expect(JSON.stringify(failure)).not.toContain(permanentError.message);
  });

  test("opens the circuit for a repeatedly failed fingerprint", async () => {
    const fake = createFakeSql({ failureCount: () => 3 });
    let downloads = 0;

    const result = await runMimitCronImport({
      sql: fake.sql,
      fetchMetadata: async () => metadata("broken-version"),
      downloadDataset: async () => {
        downloads += 1;
        throw new Error("download should not be called");
      },
      isTransientFetchError: () => false,
    });

    expect(result).toMatchObject({
      status: "skipped",
      runId: "run-1",
      reason: "circuit-open",
    });
    expect(downloads).toBe(0);
    expect(
      fake.events.some(
        ({ text }) =>
          text.includes("status = 'skipped'") &&
          text.includes("Circuit breaker open"),
      ),
    ).toBeTrue();
  });

  test("a new metadata fingerprint bypasses a circuit opened for the old version", async () => {
    const oldMetadata = metadata("old");
    const oldFingerprint = getMimitCircuitFingerprint(oldMetadata);
    const fake = createFakeSql({
      failureCount: (fingerprint) =>
        fingerprint === oldFingerprint ? 3 : 0,
      unchangedDatasetId: "dataset-new",
    });

    const oldResult = await runMimitCronImport({
      sql: fake.sql,
      fetchMetadata: async () => oldMetadata,
      downloadDataset: neverDownload(),
      isTransientFetchError: () => false,
    });
    expect(oldResult.reason).toBe("circuit-open");

    const newResult = await runMimitCronImport({
      sql: fake.sql,
      fetchMetadata: async () => metadata("new"),
      downloadDataset: neverDownload(),
      isTransientFetchError: () => false,
    });
    expect(newResult).toMatchObject({
      status: "skipped",
      datasetId: "dataset-new",
      reason: "metadata-unchanged",
    });
  });
});

describe("MIMIT database diagnostics", () => {
  test("classifies supported PostgreSQL and Node error codes", () => {
    const cases = [
      ["28P01", "authentication_failed"],
      ["28000", "authentication_failed"],
      ["ETIMEDOUT", "connection_timeout"],
      ["connect_timeout", "connection_timeout"],
      ["ENOTFOUND", "dns_failed"],
      ["eai_again", "dns_failed"],
      ["ECONNREFUSED", "connection_refused"],
      ["42501", "permission_denied"],
      ["3D000", "database_not_found"],
      ["ECONNRESET", "connection_reset"],
      ["08006", "connection_failure"],
      ["53300", "resource_exhausted"],
      ["57P01", "server_unavailable"],
      ["58000", "server_unavailable"],
      ["42P01", "schema_unavailable"],
      ["42883", "unsupported_database_feature"],
    ] as const;

    for (const [code, reason] of cases) {
      expect(classifyMimitCronDatabaseError({ code })).toBe(reason);
    }
    expect(classifyMimitCronDatabaseError({ code: "UNRECOGNIZED" })).toBe(
      "unknown",
    );
  });

  test("finds a supported code in nested causes", () => {
    const error = {
      code: "OUTER_UNKNOWN",
      cause: {
        cause: {
          code: "econnrefused",
        },
      },
    };

    expect(classifyMimitCronDatabaseError(error)).toBe("connection_refused");
  });

  test("classifies postgres.js message-only failures", () => {
    const cases = [
      ["connect_timeout reached while opening a socket", "connection_timeout"],
      ["connection timed out", "connection_timeout"],
      ["getaddrinfo ENOTFOUND db.example.test", "dns_failed"],
      ["password authentication failed for user", "authentication_failed"],
      ["connect ECONNREFUSED 127.0.0.1:5432", "connection_refused"],
      ["connection reset by peer", "connection_reset"],
    ] as const;

    for (const [message, reason] of cases) {
      expect(classifyMimitCronDatabaseError({ message })).toBe(reason);
    }
    expect(
      classifyMimitCronDatabaseError({
        code: "UNMAPPED",
        message: "getaddrinfo ENOTFOUND db.example.test",
      }),
    ).toBe("dns_failed");
    const oversizedCode = "X".repeat(65);
    expect(
      classifyMimitCronDatabaseError({
        code: oversizedCode,
        message: "connection reset by peer",
      }),
    ).toBe("connection_reset");
    expect(classifyMimitCronDatabaseError({ code: oversizedCode })).toBe(
      "unknown",
    );
  });

  test("prefers a specific code mapping over a conflicting message", () => {
    expect(
      classifyMimitCronDatabaseError({
        code: "ECONNREFUSED",
        message: "password authentication failed after a timeout",
      }),
    ).toBe("connection_refused");
    expect(
      classifyMimitCronDatabaseError({
        code: "08006",
        message: "password authentication failed",
      }),
    ).toBe("connection_failure");
  });

  test("allows client initialization to force its dedicated reason", () => {
    const error = new MimitCronDatabaseUnavailableError(
      { code: "28P01" },
      "client_initialization_failed",
    );

    expect(error.reason).toBe("client_initialization_failed");
  });

  test("classifies supported codes from AggregateError children", () => {
    expect(
      classifyMimitCronDatabaseError(
        new AggregateError([{ code: "ETIMEDOUT" }]),
      ),
    ).toBe("connection_timeout");
    expect(
      classifyMimitCronDatabaseError(
        new AggregateError([{ code: "ENOTFOUND" }]),
      ),
    ).toBe("dns_failed");
  });

  test("prefers any aggregate child code over message fallbacks", () => {
    const error = new AggregateError(
      [{ code: "28P01" }],
      "connection timed out while opening the wrapper",
    );

    expect(classifyMimitCronDatabaseError(error)).toBe(
      "authentication_failed",
    );
  });

  test("keeps the first message candidate when no code is classified", () => {
    const error = new AggregateError(
      [{ message: "password authentication failed" }],
      "connection timed out while opening the wrapper",
    );

    expect(classifyMimitCronDatabaseError(error)).toBe("connection_timeout");
  });

  test("visits a cause before aggregate children at the same level", () => {
    const error = Object.assign(
      new AggregateError([{ code: "ETIMEDOUT" }]),
      { cause: { code: "ENOTFOUND" } },
    );

    expect(classifyMimitCronDatabaseError(error)).toBe("dns_failed");
  });

  test("deduplicates aggregate children and terminates cycles", () => {
    const child = { code: "ECONNREFUSED" };
    const error = new AggregateError([] as unknown[]);
    error.errors.push(error, child, child);
    Object.defineProperty(error, "cause", { value: error });

    expect(classifyMimitCronDatabaseError(error)).toBe("connection_refused");
  });

  test("finds a child within the sixteen-node cap and ignores the seventeenth node", () => {
    const withinCap = Array.from({ length: 14 }, () => ({
      code: "UNMAPPED",
    }));
    withinCap.push({ code: "ETIMEDOUT" });
    const beyondCap = Array.from({ length: 15 }, () => ({
      code: "UNMAPPED",
    }));
    beyondCap.push({ code: "ETIMEDOUT" });

    expect(
      classifyMimitCronDatabaseError(new AggregateError(withinCap)),
    ).toBe("connection_timeout");
    expect(
      classifyMimitCronDatabaseError(new AggregateError(beyondCap)),
    ).toBe("unknown");
  });

  test("bounds traversal to sixteen error objects", () => {
    let error: Record<string, unknown> = { code: "ENOTFOUND" };
    for (let index = 0; index < 16; index += 1) {
      error = { cause: error };
    }

    expect(classifyMimitCronDatabaseError(error)).toBe("unknown");
  });

  test("handles hostile aggregate collections without throwing", () => {
    const errorsGetter = {};
    Object.defineProperty(errorsGetter, "errors", {
      get() {
        throw new Error("hostile errors getter");
      },
    });

    const revoked = Proxy.revocable([], {});
    revoked.revoke();
    const revokedErrors = { errors: revoked.proxy };

    const hostileLength = {
      errors: new Proxy([], {
        get(target, property, receiver) {
          if (property === "length") throw new Error("hostile length");
          return Reflect.get(target, property, receiver);
        },
      }),
    };
    const hostileItem = {
      errors: new Proxy([{}], {
        get(target, property, receiver) {
          if (property === "0") throw new Error("hostile item");
          return Reflect.get(target, property, receiver);
        },
      }),
    };

    for (const error of [
      errorsGetter,
      revokedErrors,
      hostileLength,
      hostileItem,
    ]) {
      expect(classifyMimitCronDatabaseError(error)).toBe("unknown");
    }
  });

  test("ignores primitive roots and aggregate children", () => {
    for (const primitive of [null, undefined, false, 0, "ETIMEDOUT"]) {
      expect(classifyMimitCronDatabaseError(primitive)).toBe("unknown");
    }
    expect(
      classifyMimitCronDatabaseError(
        new AggregateError([null, undefined, false, 0, "ENOTFOUND"]),
      ),
    ).toBe("unknown");

    let itemReads = 0;
    const manyPrimitives = new Proxy(Array<unknown>(100).fill(null), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          itemReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    expect(
      classifyMimitCronDatabaseError({ errors: manyPrimitives }),
    ).toBe("unknown");
    expect(itemReads).toBe(16);
  });

  test("handles cause cycles and hostile getters without throwing", () => {
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;

    const hostile = {};
    const messageCanary = "hostile-message-canary";
    Object.defineProperties(hostile, {
      code: {
        get() {
          throw new Error("sensitive code getter");
        },
      },
      cause: {
        get() {
          throw new Error("sensitive cause getter");
        },
      },
      message: {
        get() {
          throw new Error(messageCanary);
        },
      },
    });

    expect(classifyMimitCronDatabaseError(cyclic)).toBe("unknown");
    const hostileReason = classifyMimitCronDatabaseError(hostile);
    expect(hostileReason).toBe("unknown");
    expect(String(hostileReason)).not.toContain(messageCanary);
  });

  test("ignores inherited diagnostic fields on a plain object", () => {
    const canary = "inherited-diagnostics-canary";
    Object.defineProperties(Object.prototype, {
      code: { configurable: true, value: "28P01" },
      message: { configurable: true, value: `${canary} timed out` },
      cause: {
        configurable: true,
        value: { code: "ENOTFOUND", canary },
      },
      errors: {
        configurable: true,
        value: [{ code: "ECONNREFUSED", canary }],
      },
    });

    try {
      const reason = classifyMimitCronDatabaseError({});

      expect(reason).toBe("unknown");
      expect(String(reason)).not.toContain(canary);
    } finally {
      for (const field of ["code", "message", "cause", "errors"] as const) {
        delete (Object.prototype as Record<string, unknown>)[field];
      }
    }
  });

  test("continues to inspect standard Error own fields", () => {
    const messageError = new Error("connection timed out");
    const causeError = new Error("outer failure", {
      cause: Object.assign(new Error("inner failure"), { code: "ENOTFOUND" }),
    });
    const codeError = Object.assign(new Error("generic failure"), {
      code: "28P01",
    });

    expect(classifyMimitCronDatabaseError(messageError)).toBe(
      "connection_timeout",
    );
    expect(classifyMimitCronDatabaseError(causeError)).toBe("dns_failed");
    expect(classifyMimitCronDatabaseError(codeError)).toBe(
      "authentication_failed",
    );
  });

  test("ignores diagnostic codes inherited through Object.prototype", () => {
    const canary = "prototype-pollution-canary";
    Object.defineProperty(Object.prototype, "PWNED", {
      configurable: true,
      value: canary,
    });

    try {
      const reason = classifyMimitCronDatabaseError({ code: "pwned" });

      expect(reason).toBe("unknown");
      expect(String(reason)).not.toContain(canary);
    } finally {
      delete (Object.prototype as { PWNED?: unknown }).PWNED;
    }
  });
});

describe("MIMIT metadata fingerprints", () => {
  test("uses the strong fingerprint when validators exist", () => {
    const versioned = metadata("v1");
    const strong = getMimitMetadataFingerprint(versioned);

    expect(strong).not.toBeNull();
    expect(getMimitCircuitFingerprint(versioned)).toBe(strong!);
  });

  test("uses a stable non-null circuit fallback without validators", () => {
    const unversioned = metadata(null);
    const changed = metadata(null);
    changed.prices.contentLength = 201;

    expect(getMimitMetadataFingerprint(unversioned)).toBeNull();
    expect(getMimitCircuitFingerprint(unversioned)).toHaveLength(64);
    expect(getMimitCircuitFingerprint(unversioned)).not.toBe(
      getMimitCircuitFingerprint(changed),
    );
  });
});

describe("MIMIT import claim fencing", () => {
  test("a reclaimed worker cannot update a terminal state", async () => {
    const fake = createFakeSql({
      activeRunId: "run-a",
      loseClaimOnMetadataUpdate: true,
    });
    let downloads = 0;

    await expect(
      runMimitImport({
        sql: fake.sql,
        claimedRun: {
          id: "run-a",
          startedAt: new Date("2026-07-18T12:00:00.000Z"),
        },
        fetchMetadata: async () => metadata("stale-worker"),
        downloadDataset: async () => {
          downloads += 1;
          throw new Error("download should not be called");
        },
      }),
    ).rejects.toBeInstanceOf(MimitImportClaimLostError);

    expect(downloads).toBe(0);
    expect(
      fake.events.some(
        ({ text, values }) =>
          text.includes("status = 'failed'") && values.includes("run-a"),
      ),
    ).toBeTrue();
    expect(
      fake.events.some(
        ({ text }) =>
          text.includes("status = 'failed'") && text.includes("returning id"),
      ),
    ).toBeTrue();
  });

  test("checks the claim under lock before creating or activating a dataset", async () => {
    const fake = createFakeSql({
      activeRunId: "run-a",
      loseClaimBeforeActivation: true,
    });
    const stationsText = await Bun.file(
      `${import.meta.dir}/../../domain/mimit/__fixtures__/stations.valid.csv`,
    ).text();
    const pricesText = await Bun.file(
      `${import.meta.dir}/../../domain/mimit/__fixtures__/prices.valid.csv`,
    ).text();

    await expect(
      runMimitImport({
        sql: fake.sql,
        claimedRun: {
          id: "run-a",
          startedAt: new Date("2026-07-18T12:00:00.000Z"),
        },
        fetchMetadata: async () => metadata("activation-fence"),
        downloadDataset: async () => ({
          stations: {
            name: "stations",
            url: "https://example.test/stations.csv",
            text: stationsText,
            downloadedAt: "2026-07-18T12:00:01.000Z",
          },
          prices: {
            name: "prices",
            url: "https://example.test/prices.csv",
            text: pricesText,
            downloadedAt: "2026-07-18T12:00:01.000Z",
          },
        }),
      }),
    ).rejects.toBeInstanceOf(MimitImportClaimLostError);

    expect(
      fake.events.some(
        ({ text }) =>
          text.includes("from fuelradar.import_runs") && text.includes("for update"),
      ),
    ).toBeTrue();
    expect(
      fake.events.some(({ text }) =>
        text.includes("insert into fuelradar.datasets"),
      ),
    ).toBeFalse();
    expect(
      fake.events.some(({ text }) => text.includes("set is_active")),
    ).toBeFalse();
  });
});
