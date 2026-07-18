import { describe, expect, spyOn, test } from "bun:test";
import { runInNewContext } from "node:vm";

import { createMimitImportHandler } from "@/app/api/internal/mimit-import/handler";
import { GET, POST } from "@/app/api/internal/mimit-import/route";
import { fingerprintDatabaseUrl } from "@/server/mimit/cron-auth";
import {
  MimitCronConfigurationError,
  MimitCronDatabaseUnavailableError,
} from "@/server/mimit/cron-import";

const SECRET = "route-test-secret-that-is-at-least-32-characters";

function authorizedRequest(method = "POST") {
  return new Request("https://example.test/api/internal/mimit-import", {
    method,
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

function collectingLogger() {
  const errors: string[] = [];
  const infos: string[] = [];
  return {
    errors,
    infos,
    logger: {
      error: (message?: unknown) => errors.push(String(message)),
      info: (message?: unknown) => infos.push(String(message)),
    },
  };
}

describe("internal MIMIT import route", () => {
  test("rejects unauthorized GET and POST requests before server import wiring", async () => {
    const previousSecret = process.env.CRON_SECRET;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.CRON_SECRET = SECRET;
    delete process.env.DATABASE_URL;

    try {
      for (const [handler, authorization] of [
        [GET, undefined],
        [POST, "Bearer incorrect-route-secret-that-is-long-enough"],
      ] as const) {
        const response = await handler(
          new Request("https://example.test/api/internal/mimit-import", {
            method: handler === GET ? "GET" : "POST",
            headers: authorization ? { authorization } : undefined,
          }),
        );

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
          error: { code: "unauthorized", message: "Unauthorized" },
        });
      }
    } finally {
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  test("does not evaluate database error causes for an unauthorized request", async () => {
    const log = collectingLogger();
    let importCalls = 0;
    let databaseUrlCalls = 0;
    let causeReads = 0;
    const hostileCause = {};
    Object.defineProperty(hostileCause, "code", {
      get() {
        causeReads += 1;
        throw new Error("sensitive diagnostic getter");
      },
    });
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      getDatabaseUrl: () => {
        databaseUrlCalls += 1;
        return "postgresql://user:password@must-not-be-read.example/db";
      },
      runImport: async () => {
        importCalls += 1;
        throw new MimitCronDatabaseUnavailableError(hostileCause);
      },
      logger: log.logger,
    });

    const response = await handler(
      new Request("https://example.test/api/internal/mimit-import", {
        headers: { authorization: "Bearer incorrect-secret" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "unauthorized", message: "Unauthorized" },
    });
    expect(importCalls).toBe(0);
    expect(databaseUrlCalls).toBe(0);
    expect(causeReads).toBe(0);
    expect(log.errors).toHaveLength(0);
    expect(log.infos).toHaveLength(0);
  });

  test("returns a configuration error before importing the database adapter", async () => {
    const previousSecret = process.env.CRON_SECRET;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    process.env.CRON_SECRET = SECRET;
    delete process.env.DATABASE_URL;

    try {
      const response = await POST(authorizedRequest());

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: { code: "service_unavailable", message: "Service unavailable" },
      });
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(errorLog.mock.calls[0]?.[0]))).toMatchObject({
        event: "mimit_import_configuration_error",
      });
    } finally {
      errorLog.mockRestore();
      if (previousSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousSecret;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });

  test("runs one authorized import and returns its public payload", async () => {
    const log = collectingLogger();
    let importCalls = 0;
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      runImport: async () => {
        importCalls += 1;
        return {
          status: "succeeded",
          runId: "run-42",
          datasetId: "dataset-7",
          stationCount: 120,
          priceCount: 340,
          durationMs: 25,
        };
      },
      logger: log.logger,
    });

    const response = await handler(authorizedRequest());

    expect(response.status).toBe(200);
    expect(importCalls).toBe(1);
    expect(await response.json()).toEqual({
      status: "succeeded",
      runId: "run-42",
      datasetId: "dataset-7",
      stationCount: 120,
      priceCount: 340,
      durationMs: 25,
    });
    expect(log.errors).toHaveLength(0);
    expect(log.infos).toHaveLength(1);
    expect(JSON.parse(log.infos[0]!)).toEqual({
      event: "mimit_import_completed",
      status: "succeeded",
      runId: "run-42",
      datasetId: "dataset-7",
      stationCount: 120,
      priceCount: 340,
      durationMs: 25,
    });
  });

  test("maps an already-running import to conflict", async () => {
    const log = collectingLogger();
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      runImport: async () => ({
        status: "skipped",
        runId: null,
        datasetId: null,
        stationCount: 0,
        priceCount: 0,
        durationMs: 3,
        reason: "already-running",
      }),
      logger: log.logger,
    });

    const response = await handler(authorizedRequest("GET"));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: "skipped",
      runId: null,
      datasetId: null,
      stationCount: 0,
      priceCount: 0,
      durationMs: 3,
      reason: "already-running",
    });
    expect(log.errors).toHaveLength(0);
  });

  test("sanitizes import failures in the response and structured log", async () => {
    const log = collectingLogger();
    const timestamps = [1_000, 1_025];
    const unsafeUrl = "postgresql://user:password@example.test/database";
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      runImport: async () => {
        throw new Error(`${SECRET}\n${unsafeUrl}\nupstream details`);
      },
      logger: log.logger,
      now: () => timestamps.shift() ?? 1_025,
    });

    const response = await handler(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "import_failed", message: "MIMIT import failed" },
    });
    expect(log.infos).toHaveLength(0);
    expect(log.errors).toHaveLength(1);
    expect(JSON.parse(log.errors[0]!)).toEqual({
      event: "mimit_import_failed",
      durationMs: 25,
    });
    const publicOutput = JSON.stringify({ body, logs: log.errors });
    expect(publicOutput).not.toContain(SECRET);
    expect(publicOutput).not.toContain(unsafeUrl);
    expect(publicOutput).not.toContain("upstream details");
    expect(publicOutput).not.toContain("\n");
  });

  test("contains a revoked proxy thrown directly by the import", async () => {
    const log = collectingLogger();
    const canary = "revoked-proxy-import-canary";
    const unsafeUrl =
      "postgresql://revoked-user:revoked-password@private.example.test/db";
    const { proxy, revoke } = Proxy.revocable(
      { message: `${canary} ${unsafeUrl}` },
      {
        getPrototypeOf() {
          throw new Error(`${canary} prototype trap`);
        },
      },
    );
    revoke();
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      runImport: async () => {
        throw proxy;
      },
      logger: log.logger,
    });

    const response = await handler(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "import_failed", message: "MIMIT import failed" },
    });
    expect(log.infos).toHaveLength(0);
    expect(log.errors).toHaveLength(1);
    expect(JSON.parse(log.errors[0]!)).toMatchObject({
      event: "mimit_import_failed",
    });
    const publicOutput = JSON.stringify({ body, logs: log.errors });
    expect(publicOutput).not.toContain(canary);
    expect(publicOutput).not.toContain(unsafeUrl);
    expect(publicOutput).not.toContain("revoked-password");
    expect(publicOutput).not.toContain(SECRET);
  });

  test("maps a runtime configuration error to unavailable without exposing its cause", async () => {
    const log = collectingLogger();
    const timestamps = [3_000, 3_012];
    const unsafeCause = `${SECRET}\npostgresql://user:password@example.test/db`;
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      runImport: async () => {
        throw new MimitCronConfigurationError(new Error(unsafeCause));
      },
      logger: log.logger,
      now: () => timestamps.shift() ?? 3_012,
    });

    const response = await handler(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: { code: "service_unavailable", message: "Service unavailable" },
    });
    expect(log.infos).toHaveLength(0);
    expect(log.errors).toHaveLength(1);
    expect(JSON.parse(log.errors[0]!)).toEqual({
      event: "mimit_import_configuration_error",
      durationMs: 12,
    });
    const publicOutput = JSON.stringify({ body, logs: log.errors });
    expect(publicOutput).not.toContain(unsafeCause);
    expect(publicOutput).not.toContain(SECRET);
  });

  test("maps a database startup failure to database unavailable without exposing its cause", async () => {
    const log = collectingLogger();
    const timestamps = [4_000, 4_021];
    const unsafeCause = `${SECRET}\npostgresql://user:password@example.test/db`;
    const databaseCause = Object.assign(new Error(unsafeCause), {
      code: "28P01",
      canary: "diagnostic-canary-must-not-escape",
    });
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      runImport: async () => {
        throw new MimitCronDatabaseUnavailableError(databaseCause);
      },
      logger: log.logger,
      now: () => timestamps.shift() ?? 4_021,
    });

    const response = await handler(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "database_unavailable",
        message: "Service unavailable",
        reason: "authentication_failed",
        exceptionKind: "sqlstate_shaped",
        diagnosticCode: "28P01",
      },
    });
    expect(log.infos).toHaveLength(0);
    expect(log.errors).toHaveLength(1);
    expect(JSON.parse(log.errors[0]!)).toEqual({
      event: "mimit_import_database_unavailable",
      durationMs: 21,
      reason: "authentication_failed",
      exceptionKind: "sqlstate_shaped",
      diagnosticCode: "28P01",
    });
    const publicOutput = JSON.stringify({ body, logs: log.errors });
    expect(publicOutput).not.toContain(unsafeCause);
    expect(publicOutput).not.toContain(SECRET);
    expect(publicOutput).not.toContain(databaseCause.canary);
  });

  test("exposes only allowlisted diagnostics for a hostile authenticated failure", async () => {
    const log = collectingLogger();
    const databaseUrl =
      "postgresql://hostile-user:hostile-password@private-db.example.test:6543/private";
    const arbitraryCode = "HOSTILE_ARBITRARY_CODE";
    const canary = "hostile-diagnostic-canary";
    const hostileCause = Object.assign(
      new Error(
        `password=${"raw-password"} url=${databaseUrl} message=${canary}`,
      ),
      { code: arbitraryCode, extra: canary },
    );
    const expectedFingerprint = fingerprintDatabaseUrl(databaseUrl, SECRET);
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      getDatabaseUrl: () => databaseUrl,
      runImport: async () => {
        throw new MimitCronDatabaseUnavailableError(hostileCause);
      },
      logger: log.logger,
    });

    const response = await handler(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "database_unavailable",
        message: "Service unavailable",
        reason: "authentication_failed",
        exceptionKind: "error",
        databaseFingerprint: expectedFingerprint,
      },
    });
    expect(log.errors).toHaveLength(1);
    expect(JSON.parse(log.errors[0]!)).toMatchObject({
      event: "mimit_import_database_unavailable",
      reason: "authentication_failed",
      exceptionKind: "error",
      databaseFingerprint: expectedFingerprint,
    });
    const publicDiagnostics = JSON.stringify({ body, logs: log.errors });
    for (const sensitiveValue of [
      arbitraryCode,
      hostileCause.message,
      databaseUrl,
      "hostile-password",
      "raw-password",
      canary,
      SECRET,
    ]) {
      expect(publicDiagnostics).not.toContain(sensitiveValue);
    }
  });

  test("exposes allowlisted XX000 only alongside the database fingerprint", async () => {
    const log = collectingLogger();
    const databaseUrl =
      "postgresql://safe-user:private-password@pooler.example.test:6543/postgres";
    const causeCanary = "xx000-cause-canary";
    const cause = Object.assign(new Error(causeCanary), { code: "XX000" });
    const databaseFingerprint = fingerprintDatabaseUrl(databaseUrl, SECRET);
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      getDatabaseUrl: () => databaseUrl,
      runImport: async () => {
        throw new MimitCronDatabaseUnavailableError(cause);
      },
      logger: log.logger,
    });

    const response = await handler(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "database_unavailable",
        message: "Service unavailable",
        reason: "unknown",
        exceptionKind: "sqlstate_shaped",
        diagnosticCode: "XX000",
        databaseFingerprint,
      },
    });
    expect(log.errors).toHaveLength(1);
    expect(JSON.parse(log.errors[0]!)).toMatchObject({
      event: "mimit_import_database_unavailable",
      reason: "unknown",
      exceptionKind: "sqlstate_shaped",
      diagnosticCode: "XX000",
      databaseFingerprint,
    });
    const publicDiagnostics = JSON.stringify({ body, logs: log.errors });
    expect(publicDiagnostics).not.toContain(databaseUrl);
    expect(publicDiagnostics).not.toContain("private-password");
    expect(publicDiagnostics).not.toContain(causeCanary);
    expect(publicDiagnostics).not.toContain(SECRET);
  });

  test("returns the pooler circuit reason in the bounded database contract", async () => {
    const log = collectingLogger();
    const causeCanary = "pooler-cause-canary";
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      runImport: async () => {
        throw new MimitCronDatabaseUnavailableError(
          new Error(`Circuit breaker open: password rejected ${causeCanary}`),
        );
      },
      logger: log.logger,
    });

    const response = await handler(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "database_unavailable",
        message: "Service unavailable",
        reason: "pooler_circuit_open",
        exceptionKind: "error",
      },
    });
    expect(log.errors).toHaveLength(1);
    expect(JSON.parse(log.errors[0]!)).toMatchObject({
      event: "mimit_import_database_unavailable",
      reason: "pooler_circuit_open",
      exceptionKind: "error",
    });
    expect(JSON.stringify({ body, logs: log.errors })).not.toContain(
      causeCanary,
    );
  });

  test("returns only the safe tenant reason for a Supavisor tenant failure", async () => {
    const log = collectingLogger();
    const tenantCanary = "sensitive-tenant-reference";
    const handler = createMimitImportHandler({
      getSecret: () => SECRET,
      runImport: async () => {
        throw new MimitCronDatabaseUnavailableError(
          new Error(`Tenant or user not found: ${tenantCanary}`),
        );
      },
      logger: log.logger,
    });

    const response = await handler(authorizedRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: {
        code: "database_unavailable",
        message: "Service unavailable",
        reason: "pooler_tenant_not_found",
        exceptionKind: "error",
      },
    });
    expect(log.errors).toHaveLength(1);
    expect(JSON.parse(log.errors[0]!)).toMatchObject({
      event: "mimit_import_database_unavailable",
      reason: "pooler_tenant_not_found",
      exceptionKind: "error",
    });
    expect(JSON.stringify({ body, logs: log.errors })).not.toContain(
      tenantCanary,
    );
  });

  test("serializes only closed exception kinds for hostile database failures", async () => {
    const canary = "exception-kind-canary";
    const privateUrl =
      "postgresql://kind-user:private-password@private-kind.example.test/db";
    const sensitiveMessage = `${canary} password=${"private-password"} url=${privateUrl}`;

    class PostgresLikeError extends Error {
      readonly code = "28P01";
    }

    const spoofed = {
      constructor: { name: `SecretConstructor-${canary}` },
      message: sensitiveMessage,
      name: "TypeError",
      stack: `secret stack ${canary}`,
      url: privateUrl,
    };
    const hostileProxy = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error(`hostile descriptor ${canary}`);
        },
        getPrototypeOf() {
          throw new Error(`hostile prototype ${canary}`);
        },
      },
    );
    const fakeAggregate = Object.assign(new Error(sensitiveMessage), {
      errors: [new Error(`${canary} nested fake aggregate`)],
    });
    const crossRealmError = runInNewContext(
      `new Error(${JSON.stringify(sensitiveMessage)})`,
    ) as unknown;
    const crossRealmTypeError = runInNewContext(
      `new TypeError(${JSON.stringify(sensitiveMessage)})`,
    ) as unknown;
    const cases: Array<[unknown, string]> = [
      [new TypeError(sensitiveMessage), "type_error"],
      [
        new AggregateError([new Error(sensitiveMessage)], sensitiveMessage),
        "aggregate_shaped",
      ],
      [new PostgresLikeError(sensitiveMessage), "sqlstate_shaped"],
      [new Error(sensitiveMessage), "error"],
      [Object.assign(new Error(sensitiveMessage), { code: "EPERM" }), "error"],
      [fakeAggregate, "aggregate_shaped"],
      [crossRealmError, "error"],
      [crossRealmTypeError, "error"],
      [sensitiveMessage, "unrecognized"],
      [42, "unrecognized"],
      [null, "unrecognized"],
      [{ code: "28P01", message: sensitiveMessage }, "sqlstate_shaped"],
      [
        { errors: [new Error(sensitiveMessage)], message: sensitiveMessage },
        "aggregate_shaped",
      ],
      [spoofed, "unrecognized"],
      [hostileProxy, "unrecognized"],
    ];

    for (const [cause, exceptionKind] of cases) {
      const log = collectingLogger();
      const handler = createMimitImportHandler({
        getSecret: () => SECRET,
        runImport: async () => {
          throw new MimitCronDatabaseUnavailableError(cause);
        },
        logger: log.logger,
      });

      const response = await handler(authorizedRequest());
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(body).toMatchObject({
        error: {
          code: "database_unavailable",
          message: "Service unavailable",
          exceptionKind,
        },
      });
      expect(log.errors).toHaveLength(1);
      expect(JSON.parse(log.errors[0]!)).toMatchObject({
        event: "mimit_import_database_unavailable",
        exceptionKind,
      });
      const publicDiagnostics = JSON.stringify({ body, logs: log.errors });
      for (const sensitiveValue of [
        canary,
        sensitiveMessage,
        privateUrl,
        "private-password",
        "SecretConstructor",
        "secret stack",
      ]) {
        expect(publicDiagnostics).not.toContain(sensitiveValue);
      }
    }
  });

  test("returns unavailable without running an import when secret loading fails", async () => {
    const log = collectingLogger();
    const timestamps = [2_000, 2_009];
    let importCalls = 0;
    const handler = createMimitImportHandler({
      getSecret: () => {
        throw new Error(`${SECRET} could not be loaded`);
      },
      runImport: async () => {
        importCalls += 1;
        throw new Error("unreachable");
      },
      logger: log.logger,
      now: () => timestamps.shift() ?? 2_009,
    });

    const response = await handler(authorizedRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "service_unavailable", message: "Service unavailable" },
    });
    expect(importCalls).toBe(0);
    expect(log.infos).toHaveLength(0);
    expect(JSON.parse(log.errors[0]!)).toEqual({
      event: "mimit_import_configuration_error",
      durationMs: 9,
    });
    expect(log.errors.join(" ")).not.toContain(SECRET);
  });
});
