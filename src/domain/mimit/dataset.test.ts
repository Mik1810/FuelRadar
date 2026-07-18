import { describe, expect, test } from "bun:test";

import { MimitCsvError } from "@/domain/mimit/csv";
import { parseMimitDataset } from "@/domain/mimit/dataset";

async function fixture(name: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/__fixtures__/${name}`).text();
}

describe("parseMimitDataset", () => {
  test("produces the canonical model and explicit skip diagnostics", async () => {
    const result = parseMimitDataset({
      stationsText: await fixture("stations.valid.csv"),
      pricesText: await fixture("prices.valid.csv"),
    });

    expect(result.dataset.extractionDate).toBe("2026-05-23");
    expect(result.dataset.metadata).toEqual({
      stationsExtractionDate: "2026-05-23",
      pricesExtractionDate: "2026-05-23",
    });
    expect(result.dataset.stations).toEqual([
      {
        id: "100",
        operator: "Gestore Uno",
        brand: "Api-Ip",
        stationType: "Stradale",
        name: "Stazione | Centro",
        address: "Via Roma 1",
        city: "ROMA",
        province: "RM",
        latitude: 41.9028,
        longitude: 12.4964,
      },
    ]);
    expect(result.dataset.prices).toEqual([
      {
        stationId: "100",
        fuelType: "benzina",
        serviceMode: "self",
        price: 1.799,
        communicatedAt: "2026-05-23T07:05:09",
      },
      {
        stationId: "100",
        fuelType: "diesel",
        serviceMode: "served",
        price: 1.689,
        communicatedAt: "2026-05-22T18:30:00",
      },
    ]);
    expect(result.diagnostics).toEqual({
      recoveredRows: { stations: 1, prices: 0 },
      skippedStations: { missingId: 1, invalidCoordinates: 1 },
      skippedPrices: {
        missingStationId: 1,
        unsupportedFuel: 1,
        invalidServiceMode: 1,
        invalidPrice: 1,
        invalidCommunicationDate: 1,
        stationUnavailable: 1,
      },
    });
  });

  test("rejects station and price files from different extractions", async () => {
    const pricesText = (await fixture("prices.valid.csv")).replace(
      "Estrazione del 2026-05-23",
      "Estrazione del 2026-05-24",
    );

    try {
      parseMimitDataset({
        stationsText: await fixture("stations.valid.csv"),
        pricesText,
      });
      throw new Error("Expected parser to reject extraction mismatch");
    } catch (error) {
      expect(error).toBeInstanceOf(MimitCsvError);
      expect((error as MimitCsvError).message).toContain("do not match");
    }
  });
});
