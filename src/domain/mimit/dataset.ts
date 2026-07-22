import type {
  FuelRadarDataset,
  FuelRadarPrice,
  FuelRadarStation,
} from "@/domain/dataset";
import type { FuelType, ServiceMode } from "@/domain/fuel";
import { MimitCsvError, parseMimitCsv } from "@/domain/mimit/csv";
import type { MimitCsvData } from "@/domain/mimit/types";
import { isStationId } from "@/domain/station-id";

const SUPPORTED_FUELS: ReadonlyMap<string, FuelType> = new Map([
  ["benzina", "benzina"],
  ["gasolio", "diesel"],
  ["gpl", "gpl"],
  ["metano", "metano"],
]);

export type MimitDatasetDiagnostics = {
  recoveredRows: {
    stations: number;
    prices: number;
  };
  skippedStations: {
    missingId: number;
    invalidId: number;
    invalidCoordinates: number;
  };
  skippedPrices: {
    missingStationId: number;
    invalidStationId: number;
    unsupportedFuel: number;
    invalidServiceMode: number;
    invalidPrice: number;
    invalidCommunicationDate: number;
    stationUnavailable: number;
  };
};

export type MimitDatasetParseResult = {
  dataset: FuelRadarDataset;
  diagnostics: MimitDatasetDiagnostics;
};

function indexHeaders(headers: string[]): Map<string, number> {
  return new Map(headers.map((header, index) => [header, index]));
}

function field(row: string[], headers: Map<string, number>, name: string): string {
  const index = headers.get(name);
  if (index === undefined) {
    throw new Error(`Validated MIMIT CSV does not contain header: ${name}`);
  }
  return row[index]?.trim() ?? "";
}

function parseCoordinate(value: string, min: number, max: number): number | null {
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function normalizeFuel(value: string): FuelType | null {
  return SUPPORTED_FUELS.get(value.trim().toLowerCase()) ?? null;
}

function normalizeServiceMode(value: string): ServiceMode | null {
  if (value.trim() === "1") return "self";
  if (value.trim() === "0") return "served";
  return null;
}

function normalizeMimitDateTime(value: string): string | null {
  const match = value.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) return null;

  const [, dayText, monthText, yearText, hourText, minuteText, secondText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day ||
    candidate.getUTCHours() !== hour ||
    candidate.getUTCMinutes() !== minute ||
    candidate.getUTCSeconds() !== second
  ) {
    return null;
  }

  return `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}`;
}

function emptyDiagnostics(): MimitDatasetDiagnostics {
  return {
    recoveredRows: { stations: 0, prices: 0 },
    skippedStations: { missingId: 0, invalidId: 0, invalidCoordinates: 0 },
    skippedPrices: {
      missingStationId: 0,
      invalidStationId: 0,
      unsupportedFuel: 0,
      invalidServiceMode: 0,
      invalidPrice: 0,
      invalidCommunicationDate: 0,
      stationUnavailable: 0,
    },
  };
}

function parseStations(
  csv: MimitCsvData,
  diagnostics: MimitDatasetDiagnostics,
): FuelRadarStation[] {
  const headers = indexHeaders(csv.headers);
  const stations: FuelRadarStation[] = [];

  for (const row of csv.rows) {
    const id = field(row, headers, "idImpianto");
    if (!id) {
      diagnostics.skippedStations.missingId += 1;
      continue;
    }
    if (!isStationId(id)) {
      diagnostics.skippedStations.invalidId += 1;
      continue;
    }

    const latitude = parseCoordinate(field(row, headers, "Latitudine"), -90, 90);
    const longitude = parseCoordinate(field(row, headers, "Longitudine"), -180, 180);
    if (latitude === null || longitude === null) {
      diagnostics.skippedStations.invalidCoordinates += 1;
      continue;
    }

    const brand = field(row, headers, "Bandiera");
    stations.push({
      id,
      operator: field(row, headers, "Gestore"),
      brand: brand || "N/D",
      stationType: field(row, headers, "Tipo Impianto"),
      name: field(row, headers, "Nome Impianto") || brand || "Distributore",
      address: field(row, headers, "Indirizzo"),
      city: field(row, headers, "Comune"),
      province: field(row, headers, "Provincia"),
      latitude,
      longitude,
    });
  }

  return stations;
}

function parsePrices(
  csv: MimitCsvData,
  stationIds: ReadonlySet<string>,
  diagnostics: MimitDatasetDiagnostics,
): FuelRadarPrice[] {
  const headers = indexHeaders(csv.headers);
  const prices: FuelRadarPrice[] = [];

  for (const row of csv.rows) {
    const stationId = field(row, headers, "idImpianto");
    if (!stationId) {
      diagnostics.skippedPrices.missingStationId += 1;
      continue;
    }
    if (!isStationId(stationId)) {
      diagnostics.skippedPrices.invalidStationId += 1;
      continue;
    }

    const fuelType = normalizeFuel(field(row, headers, "descCarburante"));
    if (!fuelType) {
      diagnostics.skippedPrices.unsupportedFuel += 1;
      continue;
    }

    const serviceMode = normalizeServiceMode(field(row, headers, "isSelf"));
    if (!serviceMode) {
      diagnostics.skippedPrices.invalidServiceMode += 1;
      continue;
    }

    const price = Number(field(row, headers, "prezzo"));
    if (!Number.isFinite(price) || price <= 0) {
      diagnostics.skippedPrices.invalidPrice += 1;
      continue;
    }

    const communicatedAt = normalizeMimitDateTime(field(row, headers, "dtComu"));
    if (!communicatedAt) {
      diagnostics.skippedPrices.invalidCommunicationDate += 1;
      continue;
    }

    if (!stationIds.has(stationId)) {
      diagnostics.skippedPrices.stationUnavailable += 1;
      continue;
    }

    prices.push({ stationId, fuelType, serviceMode, price, communicatedAt });
  }

  return prices;
}

export function parseMimitDataset(input: {
  stationsText: string;
  pricesText: string;
}): MimitDatasetParseResult {
  const stationsCsv = parseMimitCsv("stations", input.stationsText);
  const pricesCsv = parseMimitCsv("prices", input.pricesText);

  if (stationsCsv.extractionDate !== pricesCsv.extractionDate) {
    throw new MimitCsvError(
      "invalid-extraction-date",
      "prices",
      `MIMIT extraction dates do not match: stations=${stationsCsv.extractionDate}, prices=${pricesCsv.extractionDate}`,
    );
  }

  const diagnostics = emptyDiagnostics();
  diagnostics.recoveredRows = {
    stations: stationsCsv.recoveredRows,
    prices: pricesCsv.recoveredRows,
  };
  const stations = parseStations(stationsCsv, diagnostics);
  const stationIds = new Set(stations.map(({ id }) => id));
  const prices = parsePrices(pricesCsv, stationIds, diagnostics);

  return {
    dataset: {
      extractionDate: pricesCsv.extractionDate,
      metadata: {
        stationsExtractionDate: stationsCsv.extractionDate,
        pricesExtractionDate: pricesCsv.extractionDate,
      },
      stations,
      prices,
    },
    diagnostics,
  };
}
