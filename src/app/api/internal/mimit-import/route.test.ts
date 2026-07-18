import { describe, expect, spyOn, test } from "bun:test";

import { createMimitImportHandler } from "@/app/api/internal/mimit-import/handler";
import { GET, POST } from "@/app/api/internal/mimit-import/route";
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
      },
    });
    expect(log.infos).toHaveLength(0);
    expect(log.errors).toHaveLength(1);
    expect(JSON.parse(log.errors[0]!)).toEqual({
      event: "mimit_import_database_unavailable",
      durationMs: 21,
      reason: "authentication_failed",
    });
    const publicOutput = JSON.stringify({ body, logs: log.errors });
    expect(publicOutput).not.toContain(unsafeCause);
    expect(publicOutput).not.toContain(SECRET);
    expect(publicOutput).not.toContain(databaseCause.canary);
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
      },
    });
    expect(log.errors).toHaveLength(1);
    expect(JSON.parse(log.errors[0]!)).toMatchObject({
      event: "mimit_import_database_unavailable",
      reason: "pooler_circuit_open",
    });
    expect(JSON.stringify({ body, logs: log.errors })).not.toContain(
      causeCanary,
    );
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
