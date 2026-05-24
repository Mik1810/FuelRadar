type CsvData = {
  extractionDate: string;
  headers: string[];
  rows: string[][];
};

const DATA_DIR = "data/mimit";
const STATIONS_FILE = `${DATA_DIR}/anagrafica_impianti_attivi.csv`;
const PRICES_FILE = `${DATA_DIR}/prezzo_alle_8.csv`;

const SUPPORTED_FUELS = new Map<string, string>([
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

  const rows = lines.slice(2).map((line) => line.split("|"));
  return {
    extractionDate: extractionMatch[1],
    headers,
    rows,
  };
}

function indexHeaders(headers: string[]): Map<string, number> {
  return new Map(headers.map((header, index) => [header, index]));
}

function hasValidCoordinate(latValue: string | undefined, lonValue: string | undefined): boolean {
  const lat = Number(latValue);
  const lon = Number(lonValue);
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

function communicationDate(value: string | undefined): string | null {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+/);
  if (!match) {
    return null;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function normalizeFuel(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  return SUPPORTED_FUELS.get(value.trim().toLowerCase()) ?? null;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("it-IT").format(value);
}

async function main() {
  const [stations, prices] = await Promise.all([readCsv(STATIONS_FILE), readCsv(PRICES_FILE)]);

  const stationHeaders = indexHeaders(stations.headers);
  const priceHeaders = indexHeaders(prices.headers);

  const latIndex = stationHeaders.get("Latitudine");
  const lonIndex = stationHeaders.get("Longitudine");

  if (latIndex === undefined || lonIndex === undefined) {
    throw new Error("Station file does not contain Latitudine/Longitudine headers");
  }

  let validCoordinates = 0;
  let invalidCoordinates = 0;

  for (const row of stations.rows) {
    if (hasValidCoordinate(row[latIndex], row[lonIndex])) {
      validCoordinates += 1;
    } else {
      invalidCoordinates += 1;
    }
  }

  const fuelIndex = priceHeaders.get("descCarburante");
  const selfIndex = priceHeaders.get("isSelf");
  const dtComuIndex = priceHeaders.get("dtComu");
  const priceIndex = priceHeaders.get("prezzo");

  if (
    fuelIndex === undefined ||
    selfIndex === undefined ||
    dtComuIndex === undefined ||
    priceIndex === undefined
  ) {
    throw new Error("Price file does not contain expected headers");
  }

  const fuelCounts = new Map<string, number>();
  const normalizedFuelCounts = new Map<string, number>();
  const currentDayByFuelMode = new Map<string, number>();
  let selfCount = 0;
  let servedCount = 0;
  let invalidPriceCount = 0;
  let invalidDateCount = 0;
  let currentDayPrices = 0;
  let supportedPrices = 0;
  let supportedCurrentDayPrices = 0;

  for (const row of prices.rows) {
    const rawFuel = row[fuelIndex]?.trim() ?? "";
    fuelCounts.set(rawFuel, (fuelCounts.get(rawFuel) ?? 0) + 1);

    if (row[selfIndex] === "1") {
      selfCount += 1;
    } else if (row[selfIndex] === "0") {
      servedCount += 1;
    }

    const parsedPrice = Number(row[priceIndex]);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      invalidPriceCount += 1;
    }

    const date = communicationDate(row[dtComuIndex]);
    if (!date) {
      invalidDateCount += 1;
    }

    const isCurrentDay = date === prices.extractionDate;
    if (isCurrentDay) {
      currentDayPrices += 1;
    }

    const normalizedFuel = normalizeFuel(rawFuel);
    if (!normalizedFuel) {
      continue;
    }

    supportedPrices += 1;
    normalizedFuelCounts.set(normalizedFuel, (normalizedFuelCounts.get(normalizedFuel) ?? 0) + 1);

    if (isCurrentDay) {
      supportedCurrentDayPrices += 1;
      const serviceMode = row[selfIndex] === "1" ? "self" : row[selfIndex] === "0" ? "served" : "unknown";
      const key = `${normalizedFuel}:${serviceMode}`;
      currentDayByFuelMode.set(key, (currentDayByFuelMode.get(key) ?? 0) + 1);
    }
  }

  const topFuelRows = [...fuelCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log("FuelRadar MIMIT data report");
  console.log("");
  console.log(`Station extraction date: ${stations.extractionDate}`);
  console.log(`Price extraction date:   ${prices.extractionDate}`);
  console.log("");
  console.log(`Stations:                ${formatCount(stations.rows.length)}`);
  console.log(`Stations with coords:    ${formatCount(validCoordinates)}`);
  console.log(`Stations without coords: ${formatCount(invalidCoordinates)}`);
  console.log("");
  console.log(`Prices:                  ${formatCount(prices.rows.length)}`);
  console.log(`Self prices:             ${formatCount(selfCount)}`);
  console.log(`Served prices:           ${formatCount(servedCount)}`);
  console.log(`Invalid prices:          ${formatCount(invalidPriceCount)}`);
  console.log(`Invalid dtComu values:   ${formatCount(invalidDateCount)}`);
  console.log("");
  console.log(`Current-day prices:      ${formatCount(currentDayPrices)}`);
  console.log(`Supported fuel prices:   ${formatCount(supportedPrices)}`);
  console.log(`Supported current-day:   ${formatCount(supportedCurrentDayPrices)}`);
  console.log("");
  console.log("Supported fuels:");
  for (const [fuel, count] of [...normalizedFuelCounts.entries()].sort()) {
    console.log(`- ${fuel}: ${formatCount(count)}`);
  }
  console.log("");
  console.log("Current-day supported fuel/service rows:");
  for (const [key, count] of [...currentDayByFuelMode.entries()].sort()) {
    console.log(`- ${key}: ${formatCount(count)}`);
  }
  console.log("");
  console.log("Top raw fuel names:");
  for (const [fuel, count] of topFuelRows) {
    console.log(`- ${fuel}: ${formatCount(count)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
