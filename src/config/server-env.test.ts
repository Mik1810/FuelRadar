import { describe, expect, test } from "bun:test";

import {
  parseCronEnv,
  parseMigrationEnv,
  parseRuntimeEnv,
} from "@/config/server-env";

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

  test("accepts only cron secrets with at least 32 characters", () => {
    const secret = "c".repeat(32);

    expect(parseCronEnv({ CRON_SECRET: secret })).toEqual({
      CRON_SECRET: secret,
    });
    expect(() => parseCronEnv({ CRON_SECRET: "c".repeat(31) })).toThrow(
      "CRON_SECRET",
    );
    expect(() => parseCronEnv({})).toThrow("CRON_SECRET");
  });

  test("does not echo cron or unrelated secrets in validation errors", () => {
    const shortSecret = "must-not-be-echoed";
    const unrelatedSecret = "unrelated-must-not-be-echoed";

    try {
      parseCronEnv({
        CRON_SECRET: shortSecret,
        SOME_OTHER_SECRET: unrelatedSecret,
      });
      throw new Error("Expected cron environment validation to fail.");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("CRON_SECRET");
      expect(message).not.toContain(shortSecret);
      expect(message).not.toContain(unrelatedSecret);
    }
  });
});
