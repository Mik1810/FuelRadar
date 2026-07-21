import { describe, expect, test } from "bun:test";

import { createPriceMarker, formatFuelPrice } from "@/map/price-marker";

describe("price marker model", () => {
  test("formats a valid fuel price consistently for the Italian UI", () => {
    expect(formatFuelPrice(1.749)).toBe("1,749 €/L");
    expect(formatFuelPrice(0)).toBe("Prezzo non disponibile");
  });

  test("creates a render model only for mappable prices", () => {
    expect(
      createPriceMarker({
        id: "123",
        latitude: 41.9028,
        longitude: 12.4964,
        name: "Stazione Roma",
        address: "Via Roma 1",
        price: 1.749,
        fuelType: "benzina",
        serviceMode: "self",
        distanceKm: 1.2,
      }),
    ).toMatchObject({
      position: { latitude: 41.9028, longitude: 12.4964 },
    });
    expect(
      createPriceMarker({
        id: "bad",
        latitude: 91,
        longitude: 12,
        name: "Stazione",
        address: "Via",
        price: 1,
        fuelType: "benzina",
        serviceMode: "self",
      }),
    ).toBeNull();
  });
});
