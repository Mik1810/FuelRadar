import { describe, expect, test } from "bun:test";

import {
  OPENSTREETMAP_TILE_PROVIDER,
  tileAttributionHtml,
  validateTileProvider,
} from "@/map/config";

describe("tile provider configuration", () => {
  test("keeps the official OSM template and linked attribution", () => {
    expect(validateTileProvider(OPENSTREETMAP_TILE_PROVIDER)).toBe(
      OPENSTREETMAP_TILE_PROVIDER,
    );
    expect(OPENSTREETMAP_TILE_PROVIDER.url).toBe(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    );
    expect(tileAttributionHtml(OPENSTREETMAP_TILE_PROVIDER)).toContain(
      'href="https://www.openstreetmap.org/copyright"',
    );
  });

  test("rejects an incomplete, insecure or unattributed provider", () => {
    expect(() =>
      validateTileProvider({
        ...OPENSTREETMAP_TILE_PROVIDER,
        url: "http://tiles.example.test/{z}/{x}/{y}.png",
      }),
    ).toThrow();
    expect(() =>
      validateTileProvider({
        ...OPENSTREETMAP_TILE_PROVIDER,
        attribution: [],
      }),
    ).toThrow();
    expect(() =>
      validateTileProvider({
        ...OPENSTREETMAP_TILE_PROVIDER,
        minZoom: 20,
        maxZoom: 10,
      }),
    ).toThrow();
  });
});
