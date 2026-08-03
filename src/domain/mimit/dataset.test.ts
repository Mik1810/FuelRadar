import { describe, expect, test } from "bun:test";

import { MimitCsvError } from "@/domain/mimit/csv";
import {
  parseMimitDataset,
  parseMimitPricesResource,
  parseMimitStationsResource,
} from "@/domain/mimit/dataset";

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
      skippedStations: { missingId: 1, invalidId: 0, invalidCoordinates: 1 },
      skippedPrices: {
        missingStationId: 1,
        invalidStationId: 0,
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

  test("parses daily prices against an older validated station snapshot", async () => {
    const stations = parseMimitStationsResource(
      await fixture("stations.valid.csv"),
    );
    const prices = parseMimitPricesResource(
      (await fixture("prices.valid.csv")).replace(
        "Estrazione del 2026-05-23",
        "Estrazione del 2026-05-24",
      ),
      new Set(stations.stations.map(({ id }) => id)),
    );

    expect(stations.extractionDate).toBe("2026-05-23");
    expect(prices.extractionDate).toBe("2026-05-24");
    expect(prices.prices).toHaveLength(2);
    expect(prices.skippedPrices.stationUnavailable).toBe(1);
  });

  test("skips station identifiers that cannot be used by detail URLs or favorites", () => {
    const result = parseMimitDataset({
      stationsText: [
        "Estrazione del 2026-05-23",
        "idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine",
        "bad/id|Gestore|Brand|Stradale|Nome|Via Roma|ROMA|RM|41.9|12.5",
      ].join("\n"),
      pricesText: [
        "Estrazione del 2026-05-23",
        "idImpianto|descCarburante|prezzo|isSelf|dtComu",
        "bad/id|Benzina|1.799|1|23/05/2026 07:05:09",
      ].join("\n"),
    });

    expect(result.dataset.stations).toEqual([]);
    expect(result.dataset.prices).toEqual([]);
    expect(result.diagnostics.skippedStations.invalidId).toBe(1);
    expect(result.diagnostics.skippedPrices.invalidStationId).toBe(1);
  });
});
