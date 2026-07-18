import { describe, expect, test } from "bun:test";

import { createMimitImportHandler } from "@/app/api/internal/mimit-import/handler";
import { GET, POST } from "@/app/api/internal/mimit-import/route";

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
    process.env.CRON_SECRET = SECRET;

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
