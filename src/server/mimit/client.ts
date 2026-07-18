import "server-only";

import type { MimitResourceName } from "@/domain/mimit/types";

export type MimitResourceMetadata = {
  name: MimitResourceName;
  url: string;
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
  contentType: string | null;
  checkedAt: string;
};

export type MimitResourceDownload = {
  name: MimitResourceName;
  url: string;
  text: string;
  downloadedAt: string;
};

export type MimitDatasetMetadata = {
  stations: MimitResourceMetadata;
  prices: MimitResourceMetadata;
};

export const MIMIT_RESOURCES: Record<MimitResourceName, string> = {
  stations: "https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv",
  prices: "https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv",
};

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchMimitResourceMetadata(
  name: MimitResourceName,
): Promise<MimitResourceMetadata> {
  const url = MIMIT_RESOURCES[name];
  const response = await fetch(url, { method: "HEAD", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch MIMIT ${name} metadata: HTTP ${response.status}`);
  }

  return {
    name,
    url,
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    contentLength: parseContentLength(response.headers.get("content-length")),
    contentType: response.headers.get("content-type"),
    checkedAt: new Date().toISOString(),
  };
}

export async function fetchMimitDatasetMetadata(): Promise<MimitDatasetMetadata> {
  const [stations, prices] = await Promise.all([
    fetchMimitResourceMetadata("stations"),
    fetchMimitResourceMetadata("prices"),
  ]);
  return { stations, prices };
}

export async function downloadMimitResource(
  name: MimitResourceName,
): Promise<MimitResourceDownload> {
  const url = MIMIT_RESOURCES[name];
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to download MIMIT ${name} CSV: HTTP ${response.status}`);
  }

  return {
    name,
    url,
    text: await response.text(),
    downloadedAt: new Date().toISOString(),
  };
}

export async function downloadMimitDataset(): Promise<{
  stations: MimitResourceDownload;
  prices: MimitResourceDownload;
}> {
  const [stations, prices] = await Promise.all([
    downloadMimitResource("stations"),
    downloadMimitResource("prices"),
  ]);
  return { stations, prices };
}
