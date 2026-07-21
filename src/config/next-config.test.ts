import { describe, expect, test } from "bun:test";

import nextConfig from "../../next.config";

describe("Next.js static asset headers", () => {
  test("caches the content-addressed municipality catalog immutably", async () => {
    expect(nextConfig.headers).toBeDefined();
    const headers = await nextConfig.headers!();

    expect(headers).toContainEqual({
      source:
        "/data/municipalities-:sourceDate(\\d{4}-\\d{2}-\\d{2}).:hash([a-f0-9]{12}).json",
      headers: [
        {
          key: "Cache-Control",
          value: "public, max-age=31536000, immutable",
        },
      ],
    });
  });
});
