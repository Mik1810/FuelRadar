import { describe, expect, test } from "bun:test";

import {
  fingerprintDatabaseUrl,
  hasValidCronAuthorization,
} from "@/server/mimit/cron-auth";

describe("cron authorization", () => {
  test("accepts the exact bearer secret", () => {
    const secret = "a".repeat(32);

    expect(hasValidCronAuthorization(`Bearer ${secret}`, secret)).toBeTrue();
  });

  test("rejects missing, malformed, and incorrect credentials", () => {
    const secret = "a".repeat(32);

    expect(hasValidCronAuthorization(null, secret)).toBeFalse();
    expect(hasValidCronAuthorization("", secret)).toBeFalse();
    expect(hasValidCronAuthorization(secret, secret)).toBeFalse();
    expect(hasValidCronAuthorization(`bearer ${secret}`, secret)).toBeFalse();
    expect(
      hasValidCronAuthorization(`Bearer ${"b".repeat(32)}`, secret),
    ).toBeFalse();
    expect(hasValidCronAuthorization(`Bearer ${secret}extra`, secret)).toBeFalse();
  });

  test("compares unicode secrets by their encoded value", () => {
    const secret = "carburante-è-sicuro-🔒-12345678901234567890";

    expect(hasValidCronAuthorization(`Bearer ${secret}`, secret)).toBeTrue();
    expect(
      hasValidCronAuthorization(
        `Bearer ${secret.replace("è", "e")}`,
        secret,
      ),
    ).toBeFalse();
  });
});

describe("database URL fingerprint", () => {
  test("is deterministic for the same URL and cron secret", () => {
    const databaseUrl =
      "postgresql://user:password@pooler.example.test:6543/postgres";
    const secret = "fingerprint-test-secret-that-is-at-least-32-chars";

    const first = fingerprintDatabaseUrl(databaseUrl, secret);
    const second = fingerprintDatabaseUrl(databaseUrl, secret);

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("password");
    expect(first).not.toContain("pooler.example.test");
    expect(first).not.toContain(secret);
  });

  test("changes when the database URL changes", () => {
    const secret = "fingerprint-test-secret-that-is-at-least-32-chars";
    const first = fingerprintDatabaseUrl(
      "postgresql://user:password@first.example.test:6543/postgres",
      secret,
    );
    const second = fingerprintDatabaseUrl(
      "postgresql://user:password@second.example.test:6543/postgres",
      secret,
    );

    expect(first).not.toBe(second);
  });
});
