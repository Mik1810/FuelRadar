import { describe, expect, mock, test } from "bun:test";

import {
  appleMapsDirectionsUrl,
  buildStationDetailUrl,
  fetchStationDetail,
  formatStationPrice,
  googleMapsDirectionsUrl,
  INITIAL_STATION_DETAIL_STATE,
  stationDetailReducer,
  supportsAppleMaps,
  type StationDetailFetcher,
} from "@/station-detail/station-detail";

const payload = {
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
      prices: [{ fuelType: "diesel", serviceMode: "self", price: 1.65, communicatedAt: "2026-07-20T09:00:00" }],
    },
  },
};

describe("station detail client", () => {
  test("builds only same-origin validated detail URLs", () => {
    expect(buildStationDetailUrl("123", "https://fuelradar.test/elsewhere").href).toBe("https://fuelradar.test/api/stations/123");
    expect(() => buildStationDetailUrl("bad/id", "https://fuelradar.test")).toThrow();
  });

  test("validates responses and distinguishes deleted stations", async () => {
    let requestInit: RequestInit | undefined;
    const fetcher: StationDetailFetcher = mock(async (input, init) => {
      expect(input).toBeInstanceOf(URL);
      requestInit = init;
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    const result = await fetchStationDetail("123", { fetcher, baseUrl: "https://fuelradar.test", now: new Date("2026-07-20T12:00:00Z") });
    expect(result.status).toBe("ok");
    expect(requestInit).toMatchObject({ credentials: "same-origin" });
    expect(await fetchStationDetail("123", { fetcher: async () => new Response(null, { status: 404 }), baseUrl: "https://fuelradar.test" })).toEqual({ status: "missing" });
    await expect(fetchStationDetail("123", { fetcher: async () => new Response("{}"), baseUrl: "https://fuelradar.test" })).rejects.toThrow("non è valida");
  });

  test("rejects late request actions", () => {
    const loading = stationDetailReducer(INITIAL_STATION_DETAIL_STATE, { type: "start", requestId: 2, stationId: "2" });
    expect(stationDetailReducer(loading, { type: "missing", requestId: 1, stationId: "1" })).toBe(loading);
    expect(stationDetailReducer(loading, { type: "missing", requestId: 2, stationId: "2" }).status).toBe("missing");
  });

  test("builds directions from bounded coordinates", () => {
    expect(googleMapsDirectionsUrl(41.9, 12.5).searchParams.get("destination")).toBe("41.9,12.5");
    expect(appleMapsDirectionsUrl(41.9, 12.5).searchParams.get("daddr")).toBe("41.9,12.5");
    expect(() => googleMapsDirectionsUrl(91, 12.5)).toThrow(RangeError);
    expect(supportsAppleMaps("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBeTrue();
    expect(supportsAppleMaps("Mozilla/5.0 (Linux; Android 15)")).toBeFalse();
    expect(formatStationPrice(1.65, "diesel")).toBe("1,650 €/l");
    expect(formatStationPrice(1.42, "metano")).toBe("1,420 €/kg");
  });
});
