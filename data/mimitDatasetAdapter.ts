import type {
  FuelRadarDataset,
  FuelRadarPrice,
  FuelRadarStation,
} from "@/data/fuelRadarData";
import type { MimitCsvData } from "@/data/mimitCsv";

type MimitCsvDataset = {
  stations: MimitCsvData;
  prices: MimitCsvData;
};

const SUPPORTED_FUELS: ReadonlyMap<string, FuelRadarPrice["fuelType"]> = new Map([
  ["benzina", "benzina"],
  ["gasolio", "diesel"],
  ["gpl", "gpl"],
  ["metano", "metano"],
]);

function indexHeaders(headers: string[]): Map<string, number> {
  return new Map(headers.map((header, index) => [header, index]));
}

function requiredIndex(headers: Map<string, number>, name: string): number {
  const index = headers.get(name);
  if (index === undefined) {
    throw new Error(`MIMIT CSV does not contain expected header: ${name}`);
  }

  return index;
}

function parseCoordinate(value: string | undefined, min: number, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

function normalizeFuel(value: string | undefined): FuelRadarPrice["fuelType"] | null {
  if (!value) return null;

  return SUPPORTED_FUELS.get(value.trim().toLowerCase()) ?? null;
}

function normalizeServiceMode(value: string | undefined): FuelRadarPrice["serviceMode"] | null {
  if (value === "1") return "self";
  if (value === "0") return "served";

  return null;
}

function toIsoDateTime(value: string): string {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return value;

  return `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

function stationsFromMimitCsv(csv: MimitCsvData): FuelRadarStation[] {
  const headers = indexHeaders(csv.headers);
  const idIndex = requiredIndex(headers, "idImpianto");
  const brandIndex = requiredIndex(headers, "Bandiera");
  const nameIndex = requiredIndex(headers, "Nome Impianto");
  const addressIndex = requiredIndex(headers, "Indirizzo");
  const cityIndex = requiredIndex(headers, "Comune");
  const latIndex = requiredIndex(headers, "Latitudine");
  const lonIndex = requiredIndex(headers, "Longitudine");
  const stations: FuelRadarStation[] = [];

  for (const row of csv.rows) {
    const latitude = parseCoordinate(row[latIndex], -90, 90);
    const longitude = parseCoordinate(row[lonIndex], -180, 180);
    const id = row[idIndex]?.trim();

    if (!id || latitude === null || longitude === null) {
      continue;
    }

    stations.push({
      id,
      brand: row[brandIndex]?.trim() || "N/D",
      name: row[nameIndex]?.trim() || row[brandIndex]?.trim() || "Distributore",
      address: row[addressIndex]?.trim() ?? "",
      city: row[cityIndex]?.trim() ?? "",
      latitude,
      longitude,
    });
  }

  return stations;
}

function pricesFromMimitCsv(csv: MimitCsvData): FuelRadarPrice[] {
  const headers = indexHeaders(csv.headers);
  const stationIndex = requiredIndex(headers, "idImpianto");
  const fuelIndex = requiredIndex(headers, "descCarburante");
  const priceIndex = requiredIndex(headers, "prezzo");
  const selfIndex = requiredIndex(headers, "isSelf");
  const communicatedAtIndex = requiredIndex(headers, "dtComu");
  const prices: FuelRadarPrice[] = [];

  for (const row of csv.rows) {
    const fuelType = normalizeFuel(row[fuelIndex]);
    const serviceMode = normalizeServiceMode(row[selfIndex]);
    const price = Number(row[priceIndex]);
    const stationId = row[stationIndex]?.trim();

    if (!fuelType || !serviceMode || !stationId || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    prices.push({
      stationId,
      fuelType,
      serviceMode,
      price,
      communicatedAt: toIsoDateTime(row[communicatedAtIndex]?.trim() ?? ""),
    });
  }

  return prices;
}

export function fuelRadarDatasetFromMimitCsv(
  csvDataset: MimitCsvDataset
): FuelRadarDataset {
  const prices = pricesFromMimitCsv(csvDataset.prices);
  const stationIdsWithPrices = new Set(prices.map((price) => price.stationId));
  const stations = stationsFromMimitCsv(csvDataset.stations).filter((station) =>
    stationIdsWithPrices.has(station.id)
  );
  const stationIdsWithCoordinates = new Set(stations.map((station) => station.id));

  return {
    extractionDate: csvDataset.prices.extractionDate,
    stations,
    prices: prices.filter((price) => stationIdsWithCoordinates.has(price.stationId)),
  };
}
