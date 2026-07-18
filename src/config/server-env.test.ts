import { describe, expect, test } from "bun:test";

import { parseMigrationEnv, parseRuntimeEnv } from "@/config/server-env";

describe("server environment", () => {
  test("accepts PostgreSQL runtime and migration URLs", () => {
    expect(
      parseRuntimeEnv({
        DATABASE_URL: "postgresql://user:password@pooler.example.com:6543/postgres",
      }),
    ).toEqual({
      DATABASE_URL: "postgresql://user:password@pooler.example.com:6543/postgres",
    });

    expect(
      parseMigrationEnv({
        MIGRATION_DATABASE_URL:
          "postgres://user:password@pooler.example.com:5432/postgres",
      }),
    ).toEqual({
      MIGRATION_DATABASE_URL:
        "postgres://user:password@pooler.example.com:5432/postgres",
    });
  });

  test("rejects missing values without echoing other environment variables", () => {
    expect(() => parseRuntimeEnv({ SOME_SECRET: "must-not-appear" })).toThrow(
      "DATABASE_URL",
    );

    try {
      parseRuntimeEnv({ SOME_SECRET: "must-not-appear" });
    } catch (error) {
      expect((error as Error).message).not.toContain("must-not-appear");
    }
  });

  test("rejects non-PostgreSQL URLs", () => {
    expect(() =>
      parseMigrationEnv({ MIGRATION_DATABASE_URL: "https://example.com/db" }),
    ).toThrow("postgres or postgresql protocol");
  });
});
