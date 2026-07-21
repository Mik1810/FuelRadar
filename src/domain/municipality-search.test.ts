import { describe, expect, test } from "bun:test";

import {
  createMunicipalitySearchIndex,
  normalizePlaceQuery,
  searchMunicipalities,
  type MunicipalityCatalogTuple,
} from "@/domain/municipality-search";

const municipalities: MunicipalityCatalogTuple[] = [
  ["075035", "Forlì", "FC", "Emilia-Romagna", 44.22, 12.04],
  ["066049", "L'Aquila", "AQ", "Abruzzo", 42.35, 13.4],
  [
    "007064",
    "Saint-Rhémy-en-Bosses",
    "AO",
    "Valle d'Aosta",
    45.84,
    7.18,
  ],
  ["016065", "Castro", "BG", "Lombardia", 45.8, 10.07],
  ["075096", "Castro", "LE", "Puglia", 40.01, 18.43],
  ["048017", "San Gimignano", "SI", "Toscana", 43.47, 11.04],
  ["999001", "Borgo Nuovo", "ZZ", "Regione", 42, 12, ["Borgonuovo"]],
];

const index = createMunicipalitySearchIndex(municipalities);

describe("municipality search", () => {
  test("normalizes accents, apostrophes, punctuation, case and whitespace", () => {
    expect(normalizePlaceQuery("  SAINT-Rhémy—en   Bosses ")).toBe(
      "saint rhemy en bosses",
    );
    expect(normalizePlaceQuery("L’Aquila")).toBe("l aquila");
    expect(searchMunicipalities(index, "forli")[0]?.name).toBe("Forlì");
    expect(searchMunicipalities(index, "l aquila")[0]?.name).toBe("L'Aquila");
    expect(searchMunicipalities(index, "laquila")[0]?.name).toBe("L'Aquila");
    expect(searchMunicipalities(index, "saint rhemy en bosses")[0]?.name).toBe(
      "Saint-Rhémy-en-Bosses",
    );
  });

  test("ranks exact, compact, prefix, token-prefix and substring matches", () => {
    expect(searchMunicipalities(index, "castro").map(({ name }) => name)).toEqual([
      "Castro",
      "Castro",
    ]);
    expect(searchMunicipalities(index, "san gim")[0]?.name).toBe("San Gimignano");
    expect(searchMunicipalities(index, "gimignano")[0]?.name).toBe(
      "San Gimignano",
    );
    expect(searchMunicipalities(index, "orgonu")[0]?.name).toBe("Borgo Nuovo");
    expect(searchMunicipalities(index, "borgonuovo")[0]?.name).toBe(
      "Borgo Nuovo",
    );
  });

  test("keeps homonyms distinct and returns nearby-ready coordinates", () => {
    const results = searchMunicipalities(index, "castro");
    expect(results.map(({ province, region }) => [province, region])).toEqual([
      ["BG", "Lombardia"],
      ["LE", "Puglia"],
    ]);
    expect(results[0]?.point).toEqual({ latitude: 45.8, longitude: 10.07 });
  });

  test("rejects short queries and enforces deterministic result limits", () => {
    expect(searchMunicipalities(index, "")).toEqual([]);
    expect(searchMunicipalities(index, "a")).toEqual([]);
    expect(searchMunicipalities(index, "castro", { limit: 1 })).toHaveLength(1);
    expect(searchMunicipalities(index, "castro", { limit: 200 })).toHaveLength(2);
  });
});
