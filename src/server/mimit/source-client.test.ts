import { describe, expect, test } from "bun:test";

import {
  isTransientMimitFetchError,
  MimitSourceFetchError,
} from "@/server/mimit/source-client";

describe("MIMIT source failures", () => {
  test("classifies only retryable HTTP statuses as transient", () => {
    for (const status of [408, 425, 429, 500, 502, 503]) {
      expect(
        isTransientMimitFetchError(
          new MimitSourceFetchError({
            resource: "stations",
            operation: "metadata",
            status,
          }),
        ),
      ).toBeTrue();
    }

    for (const status of [400, 401, 404, 422]) {
      expect(
        isTransientMimitFetchError(
          new MimitSourceFetchError({
            resource: "prices",
            operation: "download",
            status,
          }),
        ),
      ).toBeFalse();
    }
  });

  test("retries network and abort failures but not arbitrary errors", () => {
    expect(isTransientMimitFetchError(new TypeError("network failed"))).toBeTrue();
    expect(
      isTransientMimitFetchError(new DOMException("timed out", "AbortError")),
    ).toBeTrue();
    expect(isTransientMimitFetchError(new Error("invalid CSV"))).toBeFalse();
  });
});
