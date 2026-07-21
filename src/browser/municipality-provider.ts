import type {
  MunicipalitySuggestion,
  PlaceSearchOptions,
  PlaceSearchProvider,
} from "@/domain/geocoding";
import { MUNICIPALITY_CATALOG } from "@/generated/municipality-catalog";
import {
  createMunicipalitySearchIndex,
  isSearchableMunicipalityQuery,
  MUNICIPALITY_CATALOG_VERSION,
  searchMunicipalities,
  type MunicipalityCatalogDocument,
  type MunicipalitySearchIndex,
} from "@/domain/municipality-search";

type FetchCatalog = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "json" | "ok" | "status">>;

export type MunicipalityProviderOptions = {
  catalogUrl?: string;
  expectedCount?: number;
  fetchCatalog?: FetchCatalog;
};

function parseCatalog(
  value: unknown,
  expectedCount: number | undefined,
): MunicipalityCatalogDocument {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid municipality catalog document.");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.v !== MUNICIPALITY_CATALOG_VERSION) {
    throw new Error("Unsupported municipality catalog version.");
  }
  if (
    !Number.isInteger(candidate.count) ||
    (candidate.count as number) < 0 ||
    !Array.isArray(candidate.items) ||
    candidate.items.length !== candidate.count ||
    (expectedCount !== undefined && candidate.count !== expectedCount)
  ) {
    throw new Error("Invalid municipality catalog count.");
  }
  if (candidate.sourceDate !== MUNICIPALITY_CATALOG.sourceDate) {
    throw new Error("Unexpected municipality catalog source date.");
  }
  const codes = new Set<string>();
  for (const item of candidate.items) {
    if (
      !Array.isArray(item) ||
      (item.length !== 6 && item.length !== 7) ||
      typeof item[0] !== "string" ||
      !/^\d{6}$/.test(item[0]) ||
      typeof item[1] !== "string" ||
      item[1].trim().length === 0 ||
      item[1].length > 160 ||
      typeof item[2] !== "string" ||
      item[2].trim().length === 0 ||
      item[2].length > 4 ||
      typeof item[3] !== "string" ||
      item[3].trim().length === 0 ||
      item[3].length > 80 ||
      typeof item[4] !== "number" ||
      !Number.isFinite(item[4]) ||
      item[4] < 35 ||
      item[4] > 48 ||
      typeof item[5] !== "number" ||
      !Number.isFinite(item[5]) ||
      item[5] < 6 ||
      item[5] > 19 ||
      (item[6] !== undefined &&
        (!Array.isArray(item[6]) ||
          item[6].length > 4 ||
          !item[6].every(
            (alias) =>
              typeof alias === "string" &&
              alias.trim().length > 0 &&
              alias.length <= 160,
          )))
    ) {
      throw new Error("Invalid municipality catalog item.");
    }
    if (codes.has(item[0])) {
      throw new Error("Duplicate municipality catalog code.");
    }
    codes.add(item[0]);
  }
  return candidate as MunicipalityCatalogDocument;
}

export function createMunicipalityProvider(
  options: MunicipalityProviderOptions = {},
): PlaceSearchProvider {
  const catalogUrl = options.catalogUrl ?? MUNICIPALITY_CATALOG.url;
  const expectedCount =
    options.expectedCount ??
    (options.catalogUrl === undefined ? MUNICIPALITY_CATALOG.count : undefined);
  const fetchCatalog =
    options.fetchCatalog ?? globalThis.fetch.bind(globalThis);
  let indexPromise: Promise<MunicipalitySearchIndex> | undefined;

  function loadIndex(): Promise<MunicipalitySearchIndex> {
    if (indexPromise) return indexPromise;

    const pending = fetchCatalog(catalogUrl, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            `Unable to load municipality catalog: HTTP ${response.status}.`,
          );
        }
        const catalog = parseCatalog(await response.json(), expectedCount);
        return createMunicipalitySearchIndex(catalog.items);
      })
      .catch((error: unknown) => {
        if (indexPromise === pending) indexPromise = undefined;
        throw error;
      });
    indexPromise = pending;
    return pending;
  }

  return {
    async search(
      query: string,
      options?: PlaceSearchOptions,
    ): Promise<readonly MunicipalitySuggestion[]> {
      if (!isSearchableMunicipalityQuery(query)) return [];
      return searchMunicipalities(await loadIndex(), query, options);
    },
  };
}
