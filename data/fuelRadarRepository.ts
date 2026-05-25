import type { FuelRadarDataset } from "@/data/fuelRadarData";
import {
  getDatasetExtractionDate,
  getMetadataValues,
  loadNearbyFuelRadarDataset,
  loadFuelRadarDatasetByStationIds,
  loadFuelRadarDataset,
  setMetadataValues,
  type NearbyFuelRadarDatasetQuery,
  replaceFuelRadarDataset,
} from "@/data/fuelRadarDao";
import {
  downloadMimitDataset,
  fetchMimitDatasetMetadata,
  type MimitDatasetMetadata,
  type MimitResourceMetadata,
} from "@/data/mimitClient";
import {
  parseAndValidateMimitCsv,
  type MimitCsvData,
} from "@/data/mimitCsv";
import { fuelRadarDatasetFromMimitCsv } from "@/data/mimitDatasetAdapter";

export type FuelRadarDatasetQuery = {
  nearby?: NearbyFuelRadarDatasetQuery;
};

export type MimitResourceStatus = {
  name: MimitResourceMetadata["name"];
  remote: MimitResourceMetadata;
  local: {
    etag: string | null;
    lastModified: string | null;
    contentLength: number | null;
    checkedAt: string | null;
  };
  hasChanged: boolean;
  changeReasons: string[];
};

export type MimitDatasetStatus = {
  stations: MimitResourceStatus;
  prices: MimitResourceStatus;
  hasChanged: boolean;
  changeReasons: string[];
};

export type MimitValidatedCsvDataset = {
  stations: MimitCsvData;
  prices: MimitCsvData;
};

export type MimitRefreshResult = {
  dataset: FuelRadarDataset;
  status: MimitDatasetStatus;
  imported: boolean;
};

type MimitRefreshBaseResult = {
  status: MimitDatasetStatus;
  imported: boolean;
};

let activeMimitRefresh: Promise<MimitRefreshBaseResult> | null = null;

function mimitMetadataValues(
  resource: MimitResourceMetadata
): Record<string, string | number | null> {
  const keyPrefix = `mimit.${resource.name}`;

  return {
    [`${keyPrefix}.url`]: resource.url,
    [`${keyPrefix}.etag`]: resource.etag,
    [`${keyPrefix}.last_modified`]: resource.lastModified,
    [`${keyPrefix}.content_length`]: resource.contentLength,
    [`${keyPrefix}.content_type`]: resource.contentType,
    [`${keyPrefix}.checked_at`]: resource.checkedAt,
  };
}

function importedMimitMetadataValues(
  resource: MimitResourceMetadata
): Record<string, string | number | null> {
  const keyPrefix = `mimit.imported.${resource.name}`;

  return {
    [`${keyPrefix}.etag`]: resource.etag,
    [`${keyPrefix}.last_modified`]: resource.lastModified,
    [`${keyPrefix}.content_length`]: resource.contentLength,
  };
}

function metadataKey(resource: MimitResourceMetadata["name"], field: string): string {
  return `mimit.${resource}.${field}`;
}

function importedMetadataKey(resource: MimitResourceMetadata["name"], field: string): string {
  return `mimit.imported.${resource}.${field}`;
}

function parseStoredNumber(value: string | undefined): number | null {
  if (value === undefined) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareMimitResourceMetadata(
  remote: MimitResourceMetadata,
  localValues: Record<string, string>
): MimitResourceStatus {
  const local = {
    etag: localValues[importedMetadataKey(remote.name, "etag")] ?? null,
    lastModified: localValues[importedMetadataKey(remote.name, "last_modified")] ?? null,
    contentLength: parseStoredNumber(
      localValues[importedMetadataKey(remote.name, "content_length")]
    ),
    checkedAt: localValues[metadataKey(remote.name, "checked_at")] ?? null,
  };
  const changeReasons: string[] = [];

  if (!local.etag && !local.lastModified) {
    changeReasons.push("missing_import_metadata");
  }
  if (remote.etag && local.etag !== remote.etag) {
    changeReasons.push("etag_changed");
  }
  if (remote.lastModified && local.lastModified !== remote.lastModified) {
    changeReasons.push("last_modified_changed");
  }
  if (
    remote.contentLength !== null &&
    local.contentLength !== null &&
    local.contentLength !== remote.contentLength
  ) {
    changeReasons.push("content_length_changed");
  }

  return {
    name: remote.name,
    remote,
    local,
    hasChanged: changeReasons.length > 0,
    changeReasons,
  };
}

export async function checkMimitDatasetMetadata(): Promise<MimitDatasetMetadata> {
  const metadata = await fetchMimitDatasetMetadata();

  await setMetadataValues({
    ...mimitMetadataValues(metadata.stations),
    ...mimitMetadataValues(metadata.prices),
  });

  return metadata;
}

export async function checkMimitDatasetStatus(): Promise<MimitDatasetStatus> {
  const metadataKeys = [
    metadataKey("stations", "etag"),
    metadataKey("stations", "last_modified"),
    metadataKey("stations", "content_length"),
    metadataKey("stations", "checked_at"),
    importedMetadataKey("stations", "etag"),
    importedMetadataKey("stations", "last_modified"),
    importedMetadataKey("stations", "content_length"),
    metadataKey("prices", "etag"),
    metadataKey("prices", "last_modified"),
    metadataKey("prices", "content_length"),
    metadataKey("prices", "checked_at"),
    importedMetadataKey("prices", "etag"),
    importedMetadataKey("prices", "last_modified"),
    importedMetadataKey("prices", "content_length"),
  ];
  const [localValues, remoteMetadata] = await Promise.all([
    getMetadataValues(metadataKeys),
    fetchMimitDatasetMetadata(),
  ]);
  const stations = compareMimitResourceMetadata(remoteMetadata.stations, localValues);
  const prices = compareMimitResourceMetadata(remoteMetadata.prices, localValues);

  await setMetadataValues({
    ...mimitMetadataValues(remoteMetadata.stations),
    ...mimitMetadataValues(remoteMetadata.prices),
  });

  return {
    stations,
    prices,
    hasChanged: stations.hasChanged || prices.hasChanged,
    changeReasons: [
      ...stations.changeReasons.map((reason) => `stations:${reason}`),
      ...prices.changeReasons.map((reason) => `prices:${reason}`),
    ],
  };
}

export async function downloadAndValidateMimitCsvFiles(): Promise<MimitValidatedCsvDataset> {
  const downloaded = await downloadMimitDataset();

  return {
    stations: parseAndValidateMimitCsv("stations", downloaded.stations.text),
    prices: parseAndValidateMimitCsv("prices", downloaded.prices.text),
  };
}

export async function downloadMimitFuelRadarDataset(): Promise<FuelRadarDataset> {
  return fuelRadarDatasetFromMimitCsv(await downloadAndValidateMimitCsvFiles());
}

export async function refreshLocalFuelRadarDatasetFromMimit(
  query: FuelRadarDatasetQuery = {}
): Promise<MimitRefreshResult> {
  if (activeMimitRefresh) {
    const result = await activeMimitRefresh;
    return {
      ...result,
      dataset: await loadFuelRadarDatasetForQuery(query),
    };
  }

  activeMimitRefresh = refreshLocalFuelRadarDatasetFromMimitOnce();

  try {
    const result = await activeMimitRefresh;
    return {
      ...result,
      dataset: await loadFuelRadarDatasetForQuery(query),
    };
  } finally {
    activeMimitRefresh = null;
  }
}

async function refreshLocalFuelRadarDatasetFromMimitOnce(): Promise<MimitRefreshBaseResult> {
  const status = await checkMimitDatasetStatus();

  if (!status.hasChanged) {
    return {
      status,
      imported: false,
    };
  }

  const dataset = await downloadMimitFuelRadarDataset();
  await replaceFuelRadarDataset(dataset);
  await setMetadataValues({
    ...importedMimitMetadataValues(status.stations.remote),
    ...importedMimitMetadataValues(status.prices.remote),
    "mimit.last_import_at": new Date().toISOString(),
    "mimit.last_import_extraction_date": dataset.extractionDate,
    "mimit.last_import_station_count": dataset.stations.length,
    "mimit.last_import_price_count": dataset.prices.length,
  });

  return {
    status,
    imported: true,
  };
}

export async function ensureFuelRadarDatasetSeeded(
  seedDataset: FuelRadarDataset
): Promise<void> {
  const extractionDate = await getDatasetExtractionDate();

  if (extractionDate !== seedDataset.extractionDate) {
    await replaceFuelRadarDataset(seedDataset);
  }
}

export async function loadLocalFuelRadarDataset(): Promise<FuelRadarDataset> {
  return loadFuelRadarDataset();
}

export async function loadFuelRadarDatasetForQuery(
  query: FuelRadarDatasetQuery
): Promise<FuelRadarDataset> {
  if (query.nearby) {
    return loadNearbyFuelRadarDataset(query.nearby);
  }

  return loadLocalFuelRadarDataset();
}

export async function loadFavoriteFuelRadarDataset(
  stationIds: string[]
): Promise<FuelRadarDataset> {
  return loadFuelRadarDatasetByStationIds(stationIds);
}

export async function refreshLocalFuelRadarDatasetFromSeed(
  seedDataset: FuelRadarDataset,
  query: FuelRadarDatasetQuery = {}
): Promise<FuelRadarDataset> {
  await replaceFuelRadarDataset(seedDataset);
  return loadFuelRadarDatasetForQuery(query);
}

export async function loadOrSeedFuelRadarDataset(
  seedDataset: FuelRadarDataset,
  query: FuelRadarDatasetQuery = {}
): Promise<FuelRadarDataset> {
  await ensureFuelRadarDatasetSeeded(seedDataset);
  return loadFuelRadarDatasetForQuery(query);
}
