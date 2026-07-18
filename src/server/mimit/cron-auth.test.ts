import { describe, expect, test } from "bun:test";

import { hasValidCronAuthorization } from "@/server/mimit/cron-auth";

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
