import { describe, expect, test } from "bun:test";

import { nearbySearchSchema } from "@/domain/nearby";

describe("nearbySearchSchema", () => {
  test("applies safe search defaults", () => {
    expect(
      nearbySearchSchema.parse({
        latitude: 41.9028,
        longitude: 12.4964,
        fuelType: "benzina",
        serviceMode: "self",
      }),
    ).toEqual({
      latitude: 41.9028,
      longitude: 12.4964,
      radiusKm: 10,
      fuelType: "benzina",
      serviceMode: "self",
      limit: 50,
    });
  });

  test("rejects unsafe coordinates and unbounded searches", () => {
    expect(
      nearbySearchSchema.safeParse({
        latitude: 91,
        longitude: 12.4964,
        radiusKm: 51,
        fuelType: "benzina",
        serviceMode: "self",
      }).success,
    ).toBeFalse();
    expect(
      nearbySearchSchema.safeParse({
        latitude: 41.9,
        longitude: 12.5,
        radiusKm: 0.09,
        fuelType: "benzina",
        serviceMode: "self",
      }).success,
    ).toBeFalse();
  });
});
