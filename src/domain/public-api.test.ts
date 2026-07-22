import { describe, expect, test } from "bun:test";

import {
  getDatasetFreshness,
  publicNearbyStationSchema,
  publicPriceSchema,
  stationIdSchema,
} from "@/domain/public-api";

describe("public API domain contracts", () => {
  test("bounds and normalizes station identifiers", () => {
    expect(stationIdSchema.parse("  station-42  ")).toBe("station-42");
    expect(stationIdSchema.safeParse("").success).toBeFalse();
    expect(stationIdSchema.safeParse("x".repeat(101)).success).toBeFalse();
    expect(stationIdSchema.safeParse("station/42").success).toBeFalse();
    expect(stationIdSchema.safeParse("station\n42").success).toBeFalse();
    expect(publicNearbyStationSchema.shape.id.safeParse("station/42").success).toBeFalse();
  });

  test("accepts only valid MIMIT local civil communication timestamps", () => {
    const price = { fuelType: "diesel", serviceMode: "self", price: 1.65 };

    expect(
      publicPriceSchema.safeParse({
        ...price,
        communicatedAt: "2026-07-21T09:30:00",
      }).success,
    ).toBeTrue();
    expect(
      publicPriceSchema.safeParse({
        ...price,
        communicatedAt: "2026-02-30T09:30:00",
      }).success,
    ).toBeFalse();
    expect(
      publicPriceSchema.safeParse({
        ...price,
        communicatedAt: "2026-07-21T09:30:00Z",
      }).success,
    ).toBeFalse();
    for (const communicatedAt of ["", "x", "2026-07-21"]) {
      expect(
        publicPriceSchema.safeParse({ ...price, communicatedAt }).success,
      ).toBeFalse();
    }
  });

  test("reports freshness by the Europe/Rome calendar day", () => {
    const beforeRomeMidnight = new Date("2026-07-21T21:59:59.000Z");
    const afterRomeMidnight = new Date("2026-07-21T22:00:01.000Z");

    expect(getDatasetFreshness("2026-07-20", beforeRomeMidnight)).toEqual({
      ageDays: 1,
      status: "fresh",
    });
    expect(getDatasetFreshness("2026-07-20", afterRomeMidnight)).toEqual({
      ageDays: 2,
      status: "stale",
    });
    expect(getDatasetFreshness("2026-07-23", afterRomeMidnight)).toEqual({
      ageDays: 0,
      status: "fresh",
    });
  });
});
