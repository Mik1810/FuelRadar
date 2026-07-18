import type { MimitCsvData, MimitResourceName } from "@/domain/mimit/types";

const REQUIRED_HEADERS: Record<MimitResourceName, readonly string[]> = {
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

export type MimitCsvErrorCode =
  | "empty-file"
  | "invalid-extraction-date"
  | "missing-headers"
  | "unsupported-separator"
  | "missing-required-headers"
  | "malformed-row";

export class MimitCsvError extends Error {
  constructor(
    public readonly code: MimitCsvErrorCode,
    public readonly resource: MimitResourceName,
    message: string,
    public readonly line?: number,
  ) {
    super(message);
    this.name = "MimitCsvError";
  }
}

function recoverKnownUnescapedSeparator(
  resource: MimitResourceName,
  headers: string[],
  row: string[],
): string[] | null {
  // The live station registry contains unescaped pipes in "Nome Impianto"
  // (for example "STOIL SIMPLE | gestori.prezzibenzina.it"). Because the
  // surrounding schema is fixed, only that known field can be reconstructed
  // without guessing about arbitrary malformed rows.
  if (resource !== "stations" || row.length <= headers.length) return null;

  const nameIndex = headers.indexOf("Nome Impianto");
  if (nameIndex < 0) return null;
  const extraFields = row.length - headers.length;

  return [
    ...row.slice(0, nameIndex),
    row.slice(nameIndex, nameIndex + extraFields + 1).join("|"),
    ...row.slice(nameIndex + extraFields + 1),
  ];
}

function nonEmptyLines(text: string): Array<{ value: string; line: number }> {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((value, index) => ({ value: value.trimEnd(), line: index + 1 }))
    .filter(({ value }) => value.length > 0);
}

function isIsoCalendarDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function parseMimitCsv(
  resource: MimitResourceName,
  text: string,
): MimitCsvData {
  const lines = nonEmptyLines(text);
  if (lines.length === 0) {
    throw new MimitCsvError("empty-file", resource, `MIMIT ${resource} CSV is empty`);
  }

  const extractionMatch = lines[0].value.match(
    /^Estrazione del (\d{4}-\d{2}-\d{2})$/,
  );
  if (!extractionMatch || !isIsoCalendarDate(extractionMatch[1])) {
    throw new MimitCsvError(
      "invalid-extraction-date",
      resource,
      `MIMIT ${resource} CSV has an invalid or missing extraction date at line ${lines[0].line}`,
      lines[0].line,
    );
  }

  const headerLine = lines[1];
  if (!headerLine) {
    throw new MimitCsvError(
      "missing-headers",
      resource,
      `MIMIT ${resource} CSV is missing its header row`,
    );
  }
  if (!headerLine.value.includes("|") && /[;,]/.test(headerLine.value)) {
    throw new MimitCsvError(
      "unsupported-separator",
      resource,
      `MIMIT ${resource} CSV must use the | separator`,
      headerLine.line,
    );
  }

  const headers = headerLine.value.split("|").map((header) => header.trim());
  const missingHeaders = REQUIRED_HEADERS[resource].filter(
    (header) => !headers.includes(header),
  );
  if (missingHeaders.length > 0) {
    throw new MimitCsvError(
      "missing-required-headers",
      resource,
      `MIMIT ${resource} CSV is missing headers: ${missingHeaders.join(", ")}`,
      headerLine.line,
    );
  }

  let recoveredRows = 0;
  const rows = lines.slice(2).map(({ value, line }) => {
    let row = value.split("|");
    if (row.length !== headers.length) {
      const recovered = recoverKnownUnescapedSeparator(resource, headers, row);
      if (recovered) {
        row = recovered;
        recoveredRows += 1;
      }
    }
    if (row.length !== headers.length) {
      throw new MimitCsvError(
        "malformed-row",
        resource,
        `MIMIT ${resource} CSV row ${line} has ${row.length} fields; expected ${headers.length}`,
        line,
      );
    }
    return row;
  });

  return {
    resource,
    extractionDate: extractionMatch[1],
    headers,
    rows,
    recoveredRows,
  };
}
