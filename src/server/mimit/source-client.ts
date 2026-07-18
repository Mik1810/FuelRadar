import {
  MIMIT_RESOURCES,
  type MimitDatasetMetadata,
  type MimitResourceDownload,
  type MimitResourceMetadata,
} from "@/domain/mimit/source";
import type { MimitResourceName } from "@/domain/mimit/types";

export type {
  MimitDatasetMetadata,
  MimitResourceDownload,
  MimitResourceMetadata,
};
export { MIMIT_RESOURCES };

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
    throw new Error(
      `Unable to fetch MIMIT ${name} metadata: HTTP ${response.status}`,
    );
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
    throw new Error(
      `Unable to download MIMIT ${name} CSV: HTTP ${response.status}`,
    );
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
