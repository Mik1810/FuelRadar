import { describe, expect, it } from "bun:test";

import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "./site";

describe("site configuration", () => {
  it("keeps the confirmed FuelRadar identity", () => {
    expect(SITE_NAME).toBe("FuelRadar");
    expect(SITE_TAGLINE).toBe("Trova il carburante al prezzo migliore");
    expect(SITE_DESCRIPTION).toContain(SITE_TAGLINE);
  });
});
