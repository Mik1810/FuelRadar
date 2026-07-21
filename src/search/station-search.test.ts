import { describe, expect, test } from "bun:test";

import {
  buildNearbySearchUrl,
  fetchStationSearch,
  INITIAL_STATION_SEARCH_STATE,
  normalizeSearchRadiusKm,
  stationResultMarkers,
  stationSearchReducer,
  viewportCenterChanged,
} from "@/search/station-search";
import type { PublicNearbyStation } from "@/domain/public-api";

const input = {
  origin: { latitude: 41.9028, longitude: 12.4964 },
  radiusKm: 10,
  fuelType: "benzina" as const,
  serviceMode: "self" as const,
};

const stations: PublicNearbyStation[] = [
  {
    id: "station-2", operator: "Operatore", brand: "Beta", stationType: "", name: "Beta Roma",
    address: "Via Due 2", city: "Roma", province: "RM", latitude: 41.91, longitude: 12.5,
    fuelType: "benzina", serviceMode: "self", price: 1.75, communicatedAt: "2026-07-20T10:00:00", distanceKm: 1.2,
  },
  {
    id: "station-1", operator: "Operatore", brand: "Alfa", stationType: "", name: "Alfa Roma",
    address: "Via Uno 1", city: "Roma", province: "RM", latitude: 41.92, longitude: 12.51,
    fuelType: "benzina", serviceMode: "self", price: 1.75, communicatedAt: "2026-07-20T11:00:00", distanceKm: 1.5,
  },
];

describe("station search client", () => {
  test("builds a same-origin bounded nearby query for every fuel/service combination", () => {
    for (const fuelType of ["benzina", "diesel", "gpl", "metano"] as const) {
      for (const serviceMode of ["self", "served"] as const) {
        const url = buildNearbySearchUrl({ ...input, fuelType, serviceMode }, "https://evil.example/path");
        expect(url.origin).toBe("https://evil.example");
        expect(url.pathname).toBe("/api/stations/nearby");
        expect(url.searchParams.get("limit")).toBe("200");
        expect(url.searchParams.get("fuelType")).toBe(fuelType);
        expect(url.searchParams.get("serviceMode")).toBe(serviceMode);
      }
    }
  });

  test("allows only the intended radius range", () => {
    expect(buildNearbySearchUrl({ ...input, radiusKm: 5 }, "https://fuelradar.test").searchParams.get("radiusKm")).toBe("5");
    expect(buildNearbySearchUrl({ ...input, radiusKm: 50 }, "https://fuelradar.test").searchParams.get("radiusKm")).toBe("50");
    expect(() => buildNearbySearchUrl({ ...input, radiusKm: 4.9 }, "https://fuelradar.test")).toThrow();
    expect(() => buildNearbySearchUrl({ ...input, radiusKm: 50.1 }, "https://fuelradar.test")).toThrow();
    expect(normalizeSearchRadiusKm(0.1)).toBe(5);
    expect(normalizeSearchRadiusKm(75)).toBe(50);
    expect(normalizeSearchRadiusKm(Number.NaN)).toBe(10);
  });

  test("validates payloads and derives freshness from the response extraction date", async () => {
    let requests = 0;
    const fetcher = async () => {
      requests += 1;
      return new Response(JSON.stringify({ data: { extractionDate: "2026-07-20", stations } }));
    };
    await expect(fetchStationSearch(input, { fetcher, baseUrl: "https://fuelradar.test", now: new Date("2026-07-22T10:00:00+02:00") })).resolves.toMatchObject({ freshness: { status: "stale" }, stations });
    expect(requests).toBe(1);

    await expect(fetchStationSearch(input, {
      fetcher: async () => new Response(JSON.stringify({ invalid: true })),
      baseUrl: "https://fuelradar.test",
    })).rejects.toThrow("non è valida");
  });

  test("ignores late success or failure from superseded requests", () => {
    const loading = stationSearchReducer(INITIAL_STATION_SEARCH_STATE, { type: "start", requestId: 2 });
    const late = stationSearchReducer(loading, { type: "failure", requestId: 1, message: "late" });
    expect(late).toBe(loading);
    const result = { extractionDate: "2026-07-20", freshness: { ageDays: 0, status: "fresh" as const }, stations };
    expect(stationSearchReducer(loading, { type: "success", requestId: 2, result })).toMatchObject({ status: "ready", result });
  });

  test("only turns meaningful debounced viewport moves into another query", () => {
    expect(viewportCenterChanged(input.origin, input.origin)).toBeFalse();
    expect(viewportCenterChanged(input.origin, { latitude: 41.91, longitude: 12.4964 })).toBeTrue();
  });

  test("maps exactly the API-ordered results to equally ordered marker models", () => {
    const unnamed = { ...stations[0], id: "station-unnamed", name: "", brand: "", operator: "" };
    const allStations = [...stations, unnamed];
    const markers = stationResultMarkers(allStations);
    expect(markers.map(({ id }) => id)).toEqual(allStations.map(({ id }) => id));
    expect(markers.map(({ price }) => price)).toEqual(allStations.map(({ price }) => price));
    expect(markers.at(-1)?.name).toBe("Distributore station-unnamed");
  });
});
