type CsvData = {
  extractionDate: string;
  headers: string[];
  rows: string[][];
};

type FuelType = "benzina" | "diesel" | "gpl" | "metano";
type ServiceMode = "self" | "served";

type Station = {
  id: string;
  brand: string;
  name: string;
  address: string;
  city: string;
  province: string;
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

type NearbyResult = Station & {
  distanceKm: number;
  price: Price;
};

const DATA_DIR = "data/mimit";
const STATIONS_FILE = `${DATA_DIR}/anagrafica_impianti_attivi.csv`;
const PRICES_FILE = `${DATA_DIR}/prezzo_alle_8.csv`;

const DEFAULT_LATITUDE = 41.9028;
const DEFAULT_LONGITUDE = 12.4964;
const DEFAULT_RADIUS_KM = 10;
const DEFAULT_FUEL: FuelType = "benzina";
const DEFAULT_SERVICE_MODE: ServiceMode = "self";
const DEFAULT_LIMIT = 10;

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

function formatPrice(value: number): string {
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value);
}

function formatDistance(value: number): string {
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
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
  const fuel = args.get("fuel") ?? DEFAULT_FUEL;
  const serviceMode = args.get("serviceMode") ?? DEFAULT_SERVICE_MODE;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("Invalid --lat or --lon value");
  }

  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    throw new Error("Invalid --radiusKm value");
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("Invalid --limit value");
  }

  if (!["benzina", "diesel", "gpl", "metano"].includes(fuel)) {
    throw new Error("Invalid --fuel value. Use benzina, diesel, gpl, or metano");
  }

  if (!["self", "served"].includes(serviceMode)) {
    throw new Error("Invalid --serviceMode value. Use self or served");
  }

  return {
    lat,
    lon,
    radiusKm,
    limit,
    fuel: fuel as FuelType,
    serviceMode: serviceMode as ServiceMode,
  };
}

async function loadStations(): Promise<Map<string, Station>> {
  const data = await readCsv(STATIONS_FILE);
  const headers = indexHeaders(data.headers);
  const idIndex = requiredIndex(headers, "idImpianto", STATIONS_FILE);
  const brandIndex = requiredIndex(headers, "Bandiera", STATIONS_FILE);
  const nameIndex = requiredIndex(headers, "Nome Impianto", STATIONS_FILE);
  const addressIndex = requiredIndex(headers, "Indirizzo", STATIONS_FILE);
  const cityIndex = requiredIndex(headers, "Comune", STATIONS_FILE);
  const provinceIndex = requiredIndex(headers, "Provincia", STATIONS_FILE);
  const latIndex = requiredIndex(headers, "Latitudine", STATIONS_FILE);
  const lonIndex = requiredIndex(headers, "Longitudine", STATIONS_FILE);
  const stations = new Map<string, Station>();

  for (const row of data.rows) {
    const latitude = parseCoordinate(row[latIndex], -90, 90);
    const longitude = parseCoordinate(row[lonIndex], -180, 180);
    const id = row[idIndex]?.trim();

    if (!id || latitude === null || longitude === null) {
      continue;
    }

    stations.set(id, {
      id,
      brand: row[brandIndex]?.trim() ?? "",
      name: row[nameIndex]?.trim() ?? "",
      address: row[addressIndex]?.trim() ?? "",
      city: row[cityIndex]?.trim() ?? "",
      province: row[provinceIndex]?.trim() ?? "",
      latitude,
      longitude,
    });
  }

  return stations;
}

async function loadPrices(fuel: FuelType, serviceMode: ServiceMode): Promise<{ extractionDate: string; prices: Price[] }> {
  const data = await readCsv(PRICES_FILE);
  const headers = indexHeaders(data.headers);
  const stationIndex = requiredIndex(headers, "idImpianto", PRICES_FILE);
  const fuelIndex = requiredIndex(headers, "descCarburante", PRICES_FILE);
  const priceIndex = requiredIndex(headers, "prezzo", PRICES_FILE);
  const selfIndex = requiredIndex(headers, "isSelf", PRICES_FILE);
  const communicatedAtIndex = requiredIndex(headers, "dtComu", PRICES_FILE);
  const prices: Price[] = [];

  for (const row of data.rows) {
    const normalizedFuel = normalizeFuel(row[fuelIndex]);
    const normalizedServiceMode = normalizeServiceMode(row[selfIndex]);
    const price = Number(row[priceIndex]);
    const stationId = row[stationIndex]?.trim();

    if (
      normalizedFuel !== fuel ||
      normalizedServiceMode !== serviceMode ||
      !stationId ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      continue;
    }

    prices.push({
      stationId,
      fuelType: normalizedFuel,
      serviceMode: normalizedServiceMode,
      price,
      communicatedAt: row[communicatedAtIndex]?.trim() ?? "",
    });
  }

  return {
    extractionDate: data.extractionDate,
    prices,
  };
}

async function main() {
  const args = parseArgs();
  const [stations, priceData] = await Promise.all([loadStations(), loadPrices(args.fuel, args.serviceMode)]);
  const results: NearbyResult[] = [];

  for (const price of priceData.prices) {
    const station = stations.get(price.stationId);
    if (!station) {
      continue;
    }

    const distance = distanceKm(args.lat, args.lon, station.latitude, station.longitude);
    if (distance > args.radiusKm) {
      continue;
    }

    results.push({
      ...station,
      distanceKm: distance,
      price,
    });
  }

  results.sort((a, b) => a.price.price - b.price.price || a.distanceKm - b.distanceKm);

  console.log("FuelRadar nearby query");
  console.log("");
  console.log(`Dataset date: ${priceData.extractionDate}`);
  console.log(`Center:       ${args.lat}, ${args.lon}`);
  console.log(`Radius:       ${args.radiusKm} km`);
  console.log(`Fuel:         ${args.fuel}`);
  console.log(`Service mode: ${args.serviceMode}`);
  console.log(`Matches:      ${results.length}`);
  console.log("");

  for (const [index, result] of results.slice(0, args.limit).entries()) {
    console.log(
      `${index + 1}. ${formatPrice(result.price.price)} EUR - ${formatDistance(result.distanceKm)} km - ` +
        `${result.brand || "N/D"} - ${result.name || "N/D"} - ${result.city} (${result.province})`,
    );
    console.log(`   ${result.address}`);
    console.log(`   Comunicazione prezzo: ${result.price.communicatedAt}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
