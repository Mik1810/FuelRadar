import { describe, expect, mock, spyOn, test } from "bun:test";

import {
  NO_STORE_CACHE_CONTROL,
  NEARBY_CACHE_CONTROL,
  PUBLIC_API_CACHE_CONTROL,
} from "@/app/api/public-response";
import { handleDatasetStatus } from "@/app/api/dataset/status/handler";
import { handleStationDetail } from "@/app/api/stations/[id]/handler";
import { handleNearbyStations } from "@/app/api/stations/nearby/handler";

const nearbyUrl =
  "https://fuelradar.test/api/stations/nearby?latitude=41.9&longitude=12.5&fuelType=benzina&serviceMode=self";
const nearbyStation = {
  id: "123",
  operator: "Operator",
  brand: "Brand",
  stationType: "Stradale",
  name: "Station",
  address: "Via Roma 1",
  city: "Roma",
  province: "RM",
  latitude: 41.9,
  longitude: 12.5,
  fuelType: "benzina" as const,
  serviceMode: "self" as const,
  price: 1.699,
  communicatedAt: "2026-07-20T08:30:00",
  distanceKm: 1.25,
};

async function responseBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("public station APIs", () => {
  test("validates nearby input, applies bounded defaults and returns extraction metadata", async () => {
    const getNearbyStations = mock(async () => ({
      status: "ok" as const,
      extractionDate: "2026-07-20",
      stations: [nearbyStation],
    }));

    const response = await handleNearbyStations(new Request(nearbyUrl), {
      getNearbyStations,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(NEARBY_CACHE_CONTROL);
    expect(getNearbyStations).toHaveBeenCalledWith({
      latitude: 41.9,
      longitude: 12.5,
      radiusKm: 10,
      fuelType: "benzina",
      serviceMode: "self",
      limit: 50,
    });
    expect(await responseBody(response)).toEqual({
      data: {
        extractionDate: "2026-07-20",
        stations: [nearbyStation],
      },
    });
  });

  test("rejects malformed, repeated, unknown and unbounded nearby parameters before database work", async () => {
    const invalidUrls = [
      `${nearbyUrl}&radiusKm=51`,
      `${nearbyUrl}&limit=201`,
      `${nearbyUrl}&latitude=NaN`,
      `${nearbyUrl}&latitude=`,
      `${nearbyUrl}&longitude=1e2`,
      `${nearbyUrl}&radiusKm=10&radiusKm=20`,
      `${nearbyUrl}&fuelType=diesel&fuelType=benzina`,
      `${nearbyUrl}&debug=true`,
    ];
    const getNearbyStations = mock(async () => ({
      status: "dataset-unavailable" as const,
    }));

    for (const url of invalidUrls) {
      const response = await handleNearbyStations(new Request(url), {
        getNearbyStations,
      });
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe(NO_STORE_CACHE_CONTROL);
      expect(await responseBody(response)).toEqual({
        error: {
          code: "invalid_input",
          message: "Invalid nearby search parameters.",
        },
      });
    }

    expect(getNearbyStations).not.toHaveBeenCalled();
  });

  test("distinguishes a missing dataset from a missing station", async () => {
    const datasetResponse = await handleNearbyStations(new Request(nearbyUrl), {
      getNearbyStations: async () => ({ status: "dataset-unavailable" }),
    });
    const stationResponse = await handleStationDetail(
      new Request("https://fuelradar.test/api/stations/404"),
      "404",
      {
        getStationDetail: async () => ({
          status: "station-not-found",
          extractionDate: "2026-07-20",
        }),
      },
    );

    expect(datasetResponse.status).toBe(503);
    expect(await responseBody(datasetResponse)).toEqual({
      error: {
        code: "dataset_unavailable",
        message: "No active fuel dataset is available.",
      },
    });
    expect(stationResponse.status).toBe(404);
    expect(await responseBody(stationResponse)).toEqual({
      error: { code: "station_not_found", message: "Station not found." },
    });
  });

  test("returns station detail with all prices and communication timestamps", async () => {
    const getStationDetail = mock(async () => ({
      status: "ok" as const,
      extractionDate: "2026-07-20",
      station: {
        id: "123",
        operator: "Operator",
        brand: "Brand",
        stationType: "Stradale",
        name: "Station",
        address: "Via Roma 1",
        city: "Roma",
        province: "RM",
        latitude: 41.9,
        longitude: 12.5,
        prices: [
          {
            fuelType: "diesel" as const,
            serviceMode: "self" as const,
            price: 1.65,
            communicatedAt: "2026-07-20T09:00:00",
          },
        ],
      },
    }));
    const response = await handleStationDetail(
      new Request("https://fuelradar.test/api/stations/123"),
      "123",
      { getStationDetail },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(PUBLIC_API_CACHE_CONTROL);
    expect(getStationDetail).toHaveBeenCalledWith("123");
    expect(await responseBody(response)).toEqual({
      data: {
        extractionDate: "2026-07-20",
        station: {
          id: "123",
          operator: "Operator",
          brand: "Brand",
          stationType: "Stradale",
          name: "Station",
          address: "Via Roma 1",
          city: "Roma",
          province: "RM",
          latitude: 41.9,
          longitude: 12.5,
          prices: [
            {
              fuelType: "diesel",
              serviceMode: "self",
              price: 1.65,
              communicatedAt: "2026-07-20T09:00:00",
            },
          ],
        },
      },
    });
  });

  test("rejects invalid station ids before database work", async () => {
    const getStationDetail = mock(async () => ({
      status: "station-not-found" as const,
      extractionDate: "2026-07-20",
    }));
    const response = await handleStationDetail(
      new Request("https://fuelradar.test/api/stations/invalid"),
      "x".repeat(129),
      { getStationDetail },
    );

    expect(response.status).toBe(400);
    expect(getStationDetail).not.toHaveBeenCalled();
  });

  test("rejects unexpected detail and status query parameters", async () => {
    const getStationDetail = mock(async () => ({
      status: "station-not-found" as const,
      extractionDate: "2026-07-20",
    }));
    const getActiveDatasetStatus = mock(async () => null);

    const detail = await handleStationDetail(
      new Request("https://fuelradar.test/api/stations/123?debug=true"),
      "123",
      { getStationDetail },
    );
    const status = await handleDatasetStatus(
      new Request("https://fuelradar.test/api/dataset/status?debug=true"),
      { getActiveDatasetStatus },
    );

    expect(detail.status).toBe(400);
    expect(status.status).toBe(400);
    expect(getStationDetail).not.toHaveBeenCalled();
    expect(getActiveDatasetStatus).not.toHaveBeenCalled();
  });

  test("reports dataset import and freshness and does not memoize the origin response", async () => {
    let extractionDate = "2026-07-20";
    const getActiveDatasetStatus = async () => ({
      extractionDate,
      stationsExtractionDate: extractionDate,
      pricesExtractionDate: extractionDate,
      importedAt: "2026-07-20T09:00:00.000Z",
      activatedAt: "2026-07-20T09:00:01.000Z",
      stationCount: 1,
      priceCount: 1,
      latestImport: {
        status: "succeeded" as const,
        startedAt: "2026-07-20T08:59:00.000Z",
        finishedAt: "2026-07-20T09:00:00.000Z",
        durationMs: 60_000,
      },
      freshness: { status: "fresh" as const, ageDays: 1 },
    });

    const first = await handleDatasetStatus(
      new Request("https://fuelradar.test/api/dataset/status"),
      { getActiveDatasetStatus },
    );
    extractionDate = "2026-07-21";
    const second = await handleDatasetStatus(
      new Request("https://fuelradar.test/api/dataset/status"),
      { getActiveDatasetStatus },
    );

    expect(first.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=60",
    );
    expect(await responseBody(first)).toMatchObject({
      data: { extractionDate: "2026-07-20" },
    });
    expect(await responseBody(second)).toMatchObject({
      data: { extractionDate: "2026-07-21" },
    });
  });

  test("sanitizes unexpected database failures", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleDatasetStatus(
      new Request("https://fuelradar.test/api/dataset/status"),
      {
        getActiveDatasetStatus: async () => {
          throw new Error("postgresql://user:secret@private.example/database");
        },
      },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe(NO_STORE_CACHE_CONTROL);
    expect(await responseBody(response)).toEqual({
      error: {
        code: "internal_error",
        message: "Unable to load dataset status.",
      },
    });
    expect(consoleError).toHaveBeenCalledWith(
      JSON.stringify({ event: "public_api_failed", endpoint: "dataset_status" }),
    );
    consoleError.mockRestore();
  });
});
