import { describe, expect, test } from "bun:test";

import { containsTransformedCatalogPayload } from "./check-build";

const names = [
  "Comune Raro Settentrionale",
  "Comune Raro Centrale",
  "Comune Raro Meridionale",
];

describe("municipality production bundle check", () => {
  test("detects catalog names transformed into a JavaScript module", () => {
    const module =
      `export default {items:[["1","${names[0]}"],` +
      `["2","${names[1]}"],["3","${names[2]}"]]}`;
    expect(containsTransformedCatalogPayload(Buffer.from(module), names)).toBeTrue();
  });

  test("does not fail for an isolated municipality label", () => {
    expect(
      containsTransformedCatalogPayload(
        Buffer.from(`const label="${names[0]}"`),
        names,
      ),
    ).toBeFalse();
  });
});
