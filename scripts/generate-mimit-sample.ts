type CsvData = {
  extractionDate: string;
  headers: string[];
  rows: string[][];
};

type FuelType = "benzina" | "diesel" | "gpl" | "metano";
type ServiceMode = "self" | "served";

type Station = {
  id: string;
  name: string;
  brand: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
};

type Price = {
  stationId: string;
  fuelType: FuelType;
  serviceMode: ServiceMode;
  price: number;
  communicatedAt: string;
};

const DATA_DIR = "data/mimit";
const STATIONS_FILE = `${DATA_DIR}/anagrafica_impianti_attivi.csv`;
const PRICES_FILE = `${DATA_DIR}/prezzo_alle_8.csv`;
const OUTPUT_FILE = "data/generated/sampleFuelRadarDataset.ts";

const DEFAULT_LATITUDE = 41.9028;
const DEFAULT_LONGITUDE = 12.4964;
const DEFAULT_RADIUS_KM = 10;
const DEFAULT_LIMIT = 120;

const SUPPORTED_FUELS: ReadonlyMap<string, FuelType> = new Map<string, FuelType>([
  ["benzina", "benzina"],
  ["gasolio", "diesel"],
  ["gpl", "gpl"],
  ["metano", "metano"],
]);

async function readCsv(path: string): Promise<CsvData> {
  const text = await Bun.file(path).text();
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  const extractionMatch = lines[0]?.match(/^Estrazione del (\d{4}-\d{2}-\d{2})$/);
  if (!extractionMatch) {
    throw new Error(`Missing extraction date in ${path}`);
  }

  const headers = lines[1]?.split("|") ?? [];
  if (headers.length === 0) {
    throw new Error(`Missing header in ${path}`);
  }

  return {
    extractionDate: extractionMatch[1],
    headers,
    rows: lines.slice(2).map((line) => line.split("|")),
  };
}

function indexHeaders(headers: string[]): Map<string, number> {
  return new Map(headers.map((header, index) => [header, index]));
}

function requiredIndex(headers: Map<string, number>, name: string, fileName: string): number {
  const index = headers.get(name);
  if (index === undefined) {
    throw new Error(`${fileName} does not contain expected header: ${name}`);
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

function normalizeFuel(value: string | undefined): FuelType | null {
  if (!value) {
    return null;
  }

  return SUPPORTED_FUELS.get(value.trim().toLowerCase()) ?? null;
}

function normalizeServiceMode(value: string | undefined): ServiceMode | null {
  if (value === "1") {
    return "self";
  }

  if (value === "0") {
    return "served";
  }

  return null;
}

function distanceKm(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const earthRadiusKm = 6371;
  const latDelta = toRadians(toLat - fromLat);
  const lonDelta = toRadians(toLon - fromLon);
  const fromLatRad = toRadians(fromLat);
  const toLatRad = toRadians(toLat);

  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(fromLatRad) * Math.cos(toLatRad) * Math.sin(lonDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function parseArgs() {
  const args = new Map<string, string>();

  for (const arg of Bun.argv.slice(2)) {
    const match = arg.match(/^--([^=]+)=(.+)$/);
    if (match) {
      args.set(match[1], match[2]);
    }
  }

  const lat = Number(args.get("lat") ?? DEFAULT_LATITUDE);
  const lon = Number(args.get("lon") ?? DEFAULT_LONGITUDE);
  const radiusKm = Number(args.get("radiusKm") ?? DEFAULT_RADIUS_KM);
  const limit = Number(args.get("limit") ?? DEFAULT_LIMIT);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Invalid --lat or --lon value");
  }

  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    throw new Error("Invalid --radiusKm value");
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Invalid --limit value");
  }

  return { lat, lon, radiusKm, limit };
}

async function loadStations(): Promise<Station[]> {
  const data = await readCsv(STATIONS_FILE);
  const headers = indexHeaders(data.headers);
  const idIndex = requiredIndex(headers, "idImpianto", STATIONS_FILE);
  const brandIndex = requiredIndex(headers, "Bandiera", STATIONS_FILE);
  const nameIndex = requiredIndex(headers, "Nome Impianto", STATIONS_FILE);
  const addressIndex = requiredIndex(headers, "Indirizzo", STATIONS_FILE);
  const cityIndex = requiredIndex(headers, "Comune", STATIONS_FILE);
  const latIndex = requiredIndex(headers, "Latitudine", STATIONS_FILE);
  const lonIndex = requiredIndex(headers, "Longitudine", STATIONS_FILE);
  const stations: Station[] = [];

  for (const row of data.rows) {
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

async function loadPrices(): Promise<{ extractionDate: string; prices: Price[] }> {
  const data = await readCsv(PRICES_FILE);
  const headers = indexHeaders(data.headers);
  const stationIndex = requiredIndex(headers, "idImpianto", PRICES_FILE);
  const fuelIndex = requiredIndex(headers, "descCarburante", PRICES_FILE);
  const priceIndex = requiredIndex(headers, "prezzo", PRICES_FILE);
  const selfIndex = requiredIndex(headers, "isSelf", PRICES_FILE);
  const communicatedAtIndex = requiredIndex(headers, "dtComu", PRICES_FILE);
  const prices: Price[] = [];

  for (const row of data.rows) {
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
      communicatedAt: row[communicatedAtIndex]?.trim() ?? "",
    });
  }

  return {
    extractionDate: data.extractionDate,
    prices,
  };
}

function toIsoDateTime(value: string): string {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return value;
  }

  return `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:${match[6]}Z`;
}

async function main() {
  const args = parseArgs();
  const [stations, priceData] = await Promise.all([loadStations(), loadPrices()]);
  const priceStationIds = new Set(priceData.prices.map((price) => price.stationId));
  const selectedStations = stations
    .map((station) => ({
      station,
      distanceKm: distanceKm(args.lat, args.lon, station.latitude, station.longitude),
    }))
    .filter(({ station, distanceKm }) => distanceKm <= args.radiusKm && priceStationIds.has(station.id))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, args.limit)
    .map(({ station }) => station);

  const selectedIds = new Set(selectedStations.map((station) => station.id));
  const selectedPrices = priceData.prices
    .filter((price) => selectedIds.has(price.stationId))
    .map((price) => ({
      ...price,
      communicatedAt: toIsoDateTime(price.communicatedAt),
    }));

  await Bun.write(
    OUTPUT_FILE,
    `import type { FuelRadarDataset } from "@/data/fuelRadarData";

export const SAMPLE_FUELRADAR_DATASET: FuelRadarDataset = ${JSON.stringify(
      {
        extractionDate: priceData.extractionDate,
        stations: selectedStations,
        prices: selectedPrices,
      },
      null,
      2
    )};
`
  );

  console.log("Generated MIMIT sample dataset");
  console.log(`Output:   ${OUTPUT_FILE}`);
  console.log(`Date:     ${priceData.extractionDate}`);
  console.log(`Stations: ${selectedStations.length}`);
  console.log(`Prices:   ${selectedPrices.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
