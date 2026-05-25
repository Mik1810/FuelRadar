import type { MimitResourceName } from "@/data/mimitClient";

export type MimitCsvData = {
  extractionDate: string;
  headers: string[];
  rows: string[][];
};

const REQUIRED_HEADERS: Record<MimitResourceName, string[]> = {
  stations: [
    "idImpianto",
    "Gestore",
    "Bandiera",
    "Tipo Impianto",
    "Nome Impianto",
    "Indirizzo",
    "Comune",
    "Provincia",
    "Latitudine",
    "Longitudine",
  ],
  prices: ["idImpianto", "descCarburante", "prezzo", "isSelf", "dtComu"],
};

export function parseMimitCsv(text: string): MimitCsvData {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  const extractionMatch = lines[0]?.match(/^Estrazione del (\d{4}-\d{2}-\d{2})$/);

  if (!extractionMatch) {
    throw new Error("MIMIT CSV is missing extraction date");
  }

  const headers = lines[1]?.split("|") ?? [];
  if (headers.length === 0) {
    throw new Error("MIMIT CSV is missing headers");
  }

  return {
    extractionDate: extractionMatch[1],
    headers,
    rows: lines.slice(2).map((line) => line.split("|")),
  };
}

export function validateMimitCsvHeaders(
  name: MimitResourceName,
  csv: MimitCsvData
): void {
  const missingHeaders = REQUIRED_HEADERS[name].filter(
    (header) => !csv.headers.includes(header)
  );

  if (missingHeaders.length > 0) {
    throw new Error(
      `MIMIT ${name} CSV is missing headers: ${missingHeaders.join(", ")}`
    );
  }
}

export function parseAndValidateMimitCsv(
  name: MimitResourceName,
  text: string
): MimitCsvData {
  const csv = parseMimitCsv(text);
  validateMimitCsvHeaders(name, csv);
  return csv;
}
