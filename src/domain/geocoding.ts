export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type MunicipalitySuggestion = {
  kind: "municipality";
  id: `municipality:${string}`;
  name: string;
  province: string;
  region: string;
  point: GeoPoint;
};

// Future address or neighborhood results can extend this union without changing
// the provider contract.
export type PlaceSuggestion = MunicipalitySuggestion;

export type PlaceSearchOptions = {
  limit?: number;
};

export interface PlaceSearchProvider {
  search(
    query: string,
    options?: PlaceSearchOptions,
  ): Promise<readonly PlaceSuggestion[]>;
}
