import postgres from "postgres";

import { getLocalDatabaseUrl } from "./local-database";

const localDatabaseUrl = getLocalDatabaseUrl();
const port = 30_000 + Math.floor(Math.random() * 10_000);
const baseUrl = `http://127.0.0.1:${port}`;
const sql = postgres(localDatabaseUrl, { max: 1, prepare: false });
const server = Bun.spawn(
  ["bun", "--bun", "next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, DATABASE_URL: localDatabaseUrl },
    stdout: "inherit",
    stderr: "inherit",
  },
);

let originalDatasetId: number | undefined;
let replacementDatasetId: number | undefined;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fetchJson(path: string): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(10_000),
  });
  return { response, body: await response.json() };
}

async function waitForServer(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/dataset/status`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(250);
  }
  throw new Error("Public API development server did not become ready.", {
    cause: lastError,
  });
}

async function switchDataset(): Promise<void> {
  const result = await sql.begin(async (transaction) => {
    const active = await transaction<{ id: number }[]>`
      select id::integer
      from fuelradar.datasets
      where is_active
      for update
    `;
    assert(active[0], "The local fixture has no active dataset.");

    await transaction`
      update fuelradar.datasets
      set is_active = false
      where id = ${active[0].id}
    `;
    const inserted = await transaction<{ id: number }[]>`
      insert into fuelradar.datasets (
        extraction_date,
        stations_extraction_date,
        prices_extraction_date,
        source_fingerprint,
        imported_at,
        activated_at,
        is_active,
        station_count,
        price_count
      ) values (
        '2099-01-01',
        '2099-01-01',
        '2099-01-01',
        ${`public-api-integration-${crypto.randomUUID()}`},
        now(),
        now(),
        true,
        0,
        0
      )
      returning id::integer
    `;
    assert(inserted[0], "Unable to create the replacement local dataset.");
    return { originalId: active[0].id, replacementId: inserted[0].id };
  });

  originalDatasetId = result.originalId;
  replacementDatasetId = result.replacementId;
}

async function restoreDataset(): Promise<void> {
  if (originalDatasetId === undefined || replacementDatasetId === undefined) return;

  await sql.begin(async (transaction) => {
    await transaction`
      update fuelradar.datasets
      set is_active = false
      where id = ${replacementDatasetId}
    `;
    await transaction`
      update fuelradar.datasets
      set is_active = true
      where id = ${originalDatasetId}
    `;
    await transaction`
      delete from fuelradar.datasets
      where id = ${replacementDatasetId}
    `;
  });
}

try {
  await waitForServer();

  const nearby = await fetchJson(
    "/api/stations/nearby?latitude=41.9028&longitude=12.4964&radiusKm=10&fuelType=benzina&serviceMode=self&limit=3",
  );
  assert(nearby.response.status === 200, "Nearby endpoint did not return 200.");
  assert(
    nearby.response.headers.get("Cache-Control") ===
      "private, max-age=60, must-revalidate",
    "Nearby endpoint returned an unsafe cache policy.",
  );
  assert(
    JSON.stringify(nearby.body.data.stations.map((station: any) => station.id)) ===
      JSON.stringify(["rome-cheap", "rome-near", "rome-far"]),
    "Nearby endpoint is not ordered by price and then distance.",
  );
  assert(
    nearby.body.data.stations.every((station: any) => station.communicatedAt),
    "Nearby response omitted a price communication timestamp.",
  );

  const detail = await fetchJson("/api/stations/rome-near");
  assert(detail.response.status === 200, "Station detail did not return 200.");
  assert(detail.body.data.station.prices.length === 2, "Station detail omitted prices.");

  const status = await fetchJson("/api/dataset/status");
  assert(status.response.status === 200, "Dataset status did not return 200.");
  assert(status.body.data.extractionDate === "2026-07-18", "Wrong fixture dataset.");

  const invalid = await fetchJson(
    "/api/stations/nearby?latitude=41.9&longitude=12.5&radiusKm=51&fuelType=benzina&serviceMode=self",
  );
  assert(invalid.response.status === 400, "Invalid radius was accepted.");

  const missing = await fetchJson("/api/stations/does-not-exist");
  assert(missing.response.status === 404, "Missing station was not distinguished.");

  await switchDataset();

  const changedStatus = await fetchJson("/api/dataset/status");
  assert(
    changedStatus.body.data.extractionDate === "2099-01-01",
    "Dataset status origin did not observe the atomic dataset switch.",
  );
  const changedNearby = await fetchJson(
    "/api/stations/nearby?latitude=41.9028&longitude=12.4964&fuelType=benzina&serviceMode=self",
  );
  assert(changedNearby.response.status === 200, "Empty active dataset was treated as absent.");
  assert(changedNearby.body.data.stations.length === 0, "Inactive stations leaked after switch.");
  assert(
    changedNearby.body.data.extractionDate === "2099-01-01",
    "Nearby origin did not observe the dataset switch.",
  );

  console.log(
    "Public APIs: validation, ordering, detail, cache headers and origin dataset switch passed.",
  );
} finally {
  try {
    await restoreDataset();
  } finally {
    try {
      await sql.end({ timeout: 5 });
    } finally {
      server.kill();
      await server.exited;
    }
  }
}
