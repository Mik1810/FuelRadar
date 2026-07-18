import { describe, expect, test } from "bun:test";

import { MimitCsvError, parseMimitCsv } from "@/domain/mimit/csv";

describe("parseMimitCsv", () => {
  test("reads the extraction date, pipe separator, BOM and extra headers", () => {
    const csv = parseMimitCsv(
      "prices",
      "\uFEFFEstrazione del 2026-05-23\r\n" +
        "idImpianto|descCarburante|prezzo|isSelf|dtComu|futuro\r\n" +
        "100|Benzina|1.799|1|23/05/2026 07:05:09|ok\r\n",
    );

    expect(csv.extractionDate).toBe("2026-05-23");
    expect(csv.headers.at(-1)).toBe("futuro");
    expect(csv.rows).toHaveLength(1);
    expect(csv.recoveredRows).toBe(0);
  });

  test("recovers the known unescaped pipe in a station name", () => {
    const csv = parseMimitCsv(
      "stations",
      "Estrazione del 2026-05-23\n" +
        "idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine\n" +
        "100|Gestore|Q8|Stradale|Stazione | Centro|Via Roma|ROMA|RM|41.9|12.5",
    );

    expect(csv.rows[0][4]).toBe("Stazione | Centro");
    expect(csv.recoveredRows).toBe(1);
  });

  test("rejects the old semicolon separator with a diagnostic code", () => {
    try {
      parseMimitCsv(
        "prices",
        "Estrazione del 2026-05-23\nidImpianto;descCarburante;prezzo;isSelf;dtComu",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(MimitCsvError);
      expect((error as MimitCsvError).code).toBe("unsupported-separator");
    }
  });

  test("reports missing required headers", () => {
    expect(() =>
      parseMimitCsv(
        "prices",
        "Estrazione del 2026-05-23\nidImpianto|descCarburante|prezzo|isSelf",
      ),
    ).toThrow("dtComu");
  });

  test("rejects an impossible extraction date", () => {
    expect(() =>
      parseMimitCsv(
        "prices",
        "Estrazione del 2026-02-31\nidImpianto|descCarburante|prezzo|isSelf|dtComu",
      ),
    ).toThrow("invalid or missing extraction date");
  });

  test("reports a malformed row and its source line", async () => {
    const text = await Bun.file(
      `${import.meta.dir}/__fixtures__/prices.malformed.csv`,
    ).text();

    try {
      parseMimitCsv("prices", text);
      throw new Error("Expected parser to reject the malformed fixture");
    } catch (error) {
      expect(error).toBeInstanceOf(MimitCsvError);
      expect((error as MimitCsvError).code).toBe("malformed-row");
      expect((error as MimitCsvError).line).toBe(3);
    }
  });
});
