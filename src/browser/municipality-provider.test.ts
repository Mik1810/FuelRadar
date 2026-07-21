import { describe, expect, mock, test } from "bun:test";

import { createMunicipalityProvider } from "@/browser/municipality-provider";
import type { MunicipalityCatalogDocument } from "@/domain/municipality-search";

const catalog: MunicipalityCatalogDocument = {
  v: 1,
  sourceDate: "2026-02-21",
  count: 2,
  items: [
    ["001001", "Agliè", "TO", "Piemonte", 45.36, 7.77],
    ["066049", "L'Aquila", "AQ", "Abruzzo", 42.35, 13.4],
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("municipality provider", () => {
  test("loads lazily and memoizes concurrent and repeated searches", async () => {
    let resolveResponse!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchCatalog = mock(() => pendingResponse);
    const provider = createMunicipalityProvider({
      catalogUrl: "/data/municipalities.test.json",
      expectedCount: 2,
      fetchCatalog,
    });

    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(await provider.search("a")).toEqual([]);
    expect(fetchCatalog).not.toHaveBeenCalled();

    const first = provider.search("aglie");
    const second = provider.search("aquila");
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(fetchCatalog).toHaveBeenCalledWith(
      "/data/municipalities.test.json",
      { cache: "force-cache" },
    );
    resolveResponse(jsonResponse(catalog));

    expect((await first)[0]?.name).toBe("Agliè");
    expect((await second)[0]?.name).toBe("L'Aquila");
    expect((await provider.search("aglie"))[0]?.name).toBe("Agliè");
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  test("clears a failed load so a later search can retry", async () => {
    let attempt = 0;
    const fetchCatalog = mock(async () => {
      attempt += 1;
      return attempt === 1 ? jsonResponse({}, 503) : jsonResponse(catalog);
    });
    const provider = createMunicipalityProvider({
      catalogUrl: "/data/municipalities.test.json",
      fetchCatalog,
    });

    await expect(provider.search("aglie")).rejects.toThrow("HTTP 503");
    expect((await provider.search("aglie"))[0]?.name).toBe("Agliè");
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  test("rejects unsupported versions and inconsistent counts", async () => {
    for (const invalidCatalog of [
      { ...catalog, v: 2 },
      { ...catalog, count: 3 },
    ]) {
      const provider = createMunicipalityProvider({
        catalogUrl: "/data/municipalities.test.json",
        expectedCount: 2,
        fetchCatalog: async () => jsonResponse(invalidCatalog),
      });
      await expect(provider.search("aglie")).rejects.toThrow();
    }
  });

  test("rejects malformed records before creating the search index", async () => {
    const invalidCatalog = {
      ...catalog,
      items: [catalog.items[0], ["bad", "Roma", "RM", "Lazio", 99, 12]],
    };
    const provider = createMunicipalityProvider({
      catalogUrl: "/data/municipalities.test.json",
      expectedCount: 2,
      fetchCatalog: async () => jsonResponse(invalidCatalog),
    });

    await expect(provider.search("roma")).rejects.toThrow(
      "Invalid municipality catalog item",
    );
  });

  test("rejects duplicate codes, blank labels and unexpected source dates", async () => {
    const invalidCatalogs = [
      { ...catalog, sourceDate: "2025-01-01" },
      { ...catalog, items: [catalog.items[0], catalog.items[0]] },
      {
        ...catalog,
        items: [catalog.items[0], ["066049", " ", "AQ", "Abruzzo", 42.35, 13.4]],
      },
    ];

    for (const invalidCatalog of invalidCatalogs) {
      const provider = createMunicipalityProvider({
        catalogUrl: "/data/municipalities.test.json",
        expectedCount: 2,
        fetchCatalog: async () => jsonResponse(invalidCatalog),
      });
      await expect(provider.search("aglie")).rejects.toThrow();
    }
  });
});
