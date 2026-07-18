import { expect, test } from "bun:test";

import nextConfig from "../../next.config";

test("keeps the PostgreSQL driver external to production server chunks", () => {
  expect(nextConfig).toMatchObject({
    serverExternalPackages: expect.arrayContaining(["postgres"]),
  });
});
