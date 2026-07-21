import { describe, expect, test } from "bun:test";

import { nextComboboxIndex } from "@/search/combobox";

describe("municipality combobox navigation", () => {
  test("starts, stops, and resets safely at the result list bounds", () => {
    expect(nextComboboxIndex(-1, 3, "next")).toBe(0);
    expect(nextComboboxIndex(-1, 3, "previous")).toBe(2);
    expect(nextComboboxIndex(2, 3, "next")).toBe(2);
    expect(nextComboboxIndex(0, 3, "previous")).toBe(0);
    expect(nextComboboxIndex(0, 0, "next")).toBe(-1);
  });
});
