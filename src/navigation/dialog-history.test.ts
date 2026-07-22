import { describe, expect, test } from "bun:test";

import { stationDialogHistoryState, stationIdFromHistoryState } from "@/navigation/dialog-history";

describe("station dialog history", () => {
  test("preserves unrelated state and reads only string station IDs", () => {
    const state = stationDialogHistoryState({ scroll: 10 }, "123");
    expect(state).toEqual({ scroll: 10, fuelRadarStationDetail: "123" });
    expect(stationIdFromHistoryState(state)).toBe("123");
    expect(stationIdFromHistoryState({ fuelRadarStationDetail: 123 })).toBeNull();
    expect(stationIdFromHistoryState({ fuelRadarStationDetail: "bad/id" })).toBeNull();
    expect(stationIdFromHistoryState(null)).toBeNull();
    expect(() => stationDialogHistoryState(null, "bad/id")).toThrow(TypeError);
  });
});
