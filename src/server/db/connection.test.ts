import { afterEach, describe, expect, test } from "bun:test";
import type postgres from "postgres";

import { createDatabaseConnection } from "@/server/db/connection";

type Connection = ReturnType<typeof createDatabaseConnection>;

const connections: Connection[] = [];

function createTestConnection(): Connection {
  const connection = createDatabaseConnection(
    "  postgresql://user:password@127.0.0.1:5432/fuelradar_test  ",
  );
  connections.push(connection);
  return connection;
}

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
});

describe("database connection", () => {
  test("isolates Drizzle serializer changes from the raw postgres client", () => {
    const { db, sqlClient } = createTestConnection();
    const drizzleClient = db.$client as postgres.Sql;
    const date = new Date("2026-07-21T12:34:56.000Z");
    const json = { source: "MIMIT", count: 2 };

    expect(drizzleClient).not.toBe(sqlClient);
    expect(sqlClient.options.serializers[1184]?.(date)).toBe(
      "2026-07-21T12:34:56.000Z",
    );
    expect(sqlClient.options.serializers[3802]?.(json)).toBe(
      JSON.stringify(json),
    );
    expect(drizzleClient.options.serializers[1184]?.(date)).toBe(date);
    expect(drizzleClient.options.serializers[3802]?.(json)).toBe(json);
  });

  test("preserves postgres.js composition and typed JSON values", () => {
    const { sqlClient } = createTestConnection();
    const fragment = sqlClient`now()`;
    const identifier = sqlClient("created_at");
    const json = sqlClient.json({ ok: true });
    const query = sqlClient`select ${fragment} as ${identifier}, ${json}`;
    const queryInternals = query as unknown as { args: unknown[] };
    const jsonInternals = json as unknown as { type: number; value: unknown };

    expect(queryInternals.args).toEqual([fragment, identifier, json]);
    expect(jsonInternals.value).toEqual({ ok: true });
    expect(jsonInternals.type).toBe(3802);
  });
});
