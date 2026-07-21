import type {
  MunicipalitySuggestion,
  PlaceSearchOptions,
} from "@/domain/geocoding";

export const MUNICIPALITY_CATALOG_VERSION = 1;
export const DEFAULT_MUNICIPALITY_RESULT_LIMIT = 8;
export const MAX_MUNICIPALITY_RESULT_LIMIT = 20;

export type MunicipalityCatalogTuple = readonly [
  code: string,
  name: string,
  province: string,
  region: string,
  latitude: number,
  longitude: number,
  aliases?: readonly string[],
];

export type MunicipalityCatalogDocument = {
  v: typeof MUNICIPALITY_CATALOG_VERSION;
  sourceDate: string;
  count: number;
  items: MunicipalityCatalogTuple[];
};

type SearchText = {
  normalized: string;
  compact: string;
  tokens: string[];
};

type IndexedMunicipality = {
  municipality: MunicipalitySuggestion;
  searchTexts: SearchText[];
};

export type MunicipalitySearchIndex = readonly IndexedMunicipality[];

type RankedMunicipality = {
  matchClass: number;
  matchPosition: number;
  municipality: MunicipalitySuggestion;
};

export function normalizePlaceQuery(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("it-IT")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isSearchableMunicipalityQuery(value: string): boolean {
  return normalizePlaceQuery(value).replaceAll(" ", "").length >= 2;
}

function toSearchText(value: string): SearchText | null {
  const normalized = normalizePlaceQuery(value);
  if (!normalized) return null;
  return {
    normalized,
    compact: normalized.replaceAll(" ", ""),
    tokens: normalized.split(" "),
  };
}

export function createMunicipalitySearchIndex(
  items: readonly MunicipalityCatalogTuple[],
): MunicipalitySearchIndex {
  return items.map(
    ([code, name, province, region, latitude, longitude, aliases = []]) => {
      const searchTexts = [name, ...aliases]
        .map(toSearchText)
        .filter((value): value is SearchText => value !== null);

      return {
        municipality: {
          kind: "municipality" as const,
          id: `municipality:${code}` as const,
          name,
          province,
          region,
          point: { latitude, longitude },
        },
        searchTexts,
      };
    },
  );
}

function orderedTokenPrefixMatch(
  candidateTokens: readonly string[],
  queryTokens: readonly string[],
): number {
  let candidateIndex = 0;
  let firstMatch = -1;

  for (const queryToken of queryTokens) {
    while (
      candidateIndex < candidateTokens.length &&
      !candidateTokens[candidateIndex]!.startsWith(queryToken)
    ) {
      candidateIndex += 1;
    }
    if (candidateIndex === candidateTokens.length) return -1;
    if (firstMatch === -1) firstMatch = candidateIndex;
    candidateIndex += 1;
  }

  return firstMatch;
}

function rankSearchText(candidate: SearchText, query: SearchText) {
  if (candidate.normalized === query.normalized) {
    return { matchClass: 0, matchPosition: 0 };
  }
  if (candidate.compact === query.compact) {
    return { matchClass: 1, matchPosition: 0 };
  }
  if (candidate.normalized.startsWith(query.normalized)) {
    return { matchClass: 2, matchPosition: 0 };
  }

  const tokenPosition = orderedTokenPrefixMatch(candidate.tokens, query.tokens);
  if (tokenPosition >= 0) {
    return { matchClass: 3, matchPosition: tokenPosition };
  }

  const wordBoundaryPosition = ` ${candidate.normalized}`.indexOf(
    ` ${query.normalized}`,
  );
  if (wordBoundaryPosition >= 0) {
    return { matchClass: 4, matchPosition: wordBoundaryPosition };
  }

  const compactPosition = candidate.compact.indexOf(query.compact);
  if (compactPosition >= 0) {
    return { matchClass: 5, matchPosition: compactPosition };
  }

  return null;
}

function normalizedLimit(options: PlaceSearchOptions | undefined): number {
  const requested = options?.limit;
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_MUNICIPALITY_RESULT_LIMIT;
  }
  return Math.min(
    MAX_MUNICIPALITY_RESULT_LIMIT,
    Math.max(1, Math.trunc(requested)),
  );
}

export function searchMunicipalities(
  index: MunicipalitySearchIndex,
  query: string,
  options?: PlaceSearchOptions,
): MunicipalitySuggestion[] {
  const queryText = toSearchText(query);
  if (!queryText || !isSearchableMunicipalityQuery(query)) return [];

  const ranked: RankedMunicipality[] = [];
  for (const candidate of index) {
    let bestMatch: Omit<RankedMunicipality, "municipality"> | null = null;
    for (const searchText of candidate.searchTexts) {
      const match = rankSearchText(searchText, queryText);
      if (
        match &&
        (!bestMatch ||
          match.matchClass < bestMatch.matchClass ||
          (match.matchClass === bestMatch.matchClass &&
            match.matchPosition < bestMatch.matchPosition))
      ) {
        bestMatch = match;
      }
    }
    if (bestMatch) {
      ranked.push({ ...bestMatch, municipality: candidate.municipality });
    }
  }

  ranked.sort(
    (left, right) =>
      left.matchClass - right.matchClass ||
      left.matchPosition - right.matchPosition ||
      left.municipality.name.length - right.municipality.name.length ||
      left.municipality.name.localeCompare(right.municipality.name, "it", {
        sensitivity: "base",
      }) ||
      left.municipality.province.localeCompare(right.municipality.province, "it", {
        sensitivity: "base",
      }) ||
      left.municipality.id.localeCompare(right.municipality.id),
  );

  return ranked
    .slice(0, normalizedLimit(options))
    .map(({ municipality }) => municipality);
}
