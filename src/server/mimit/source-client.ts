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

const METADATA_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;

export class MimitSourceFetchError extends Error {
  readonly transient: boolean;

  constructor(input: { resource: MimitResourceName; operation: "metadata" | "download"; status: number }) {
    super(
      `Unable to ${input.operation === "metadata" ? "fetch MIMIT metadata for" : "download MIMIT CSV for"} ${input.resource}: HTTP ${input.status}`,
    );
    this.name = "MimitSourceFetchError";
    this.transient =
      input.status === 408 ||
      input.status === 425 ||
      input.status === 429 ||
      input.status >= 500;
  }
}

export function isTransientMimitFetchError(error: unknown): boolean {
  return (
    (error instanceof MimitSourceFetchError && error.transient) ||
    error instanceof TypeError ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchMimitResourceMetadata(
  name: MimitResourceName,
): Promise<MimitResourceMetadata> {
  const url = MIMIT_RESOURCES[name];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new MimitSourceFetchError({
        resource: name,
        operation: "metadata",
        status: response.status,
      });
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
  } catch (error) {
    if (error instanceof MimitSourceFetchError) throw error;
    const msg = error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120);
    const rec = error as unknown as Record<string, unknown>;
    const code = rec?.code;
    const causeCode = error instanceof Error && rec?.cause
      ? (rec.cause as Record<string, unknown>)?.code
      : undefined;
    console.error(
      "MIMIT_FETCH_ERROR " +
        JSON.stringify({ resource: name, msg, code, causeCode }),
    );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message.slice(0, 120) : String(error).slice(0, 120);
    const rec = error as unknown as Record<string, unknown>;
    const code = rec?.code;
    const causeCode = error instanceof Error && rec?.cause
      ? (rec.cause as Record<string, unknown>)?.code
      : undefined;
    console.error(
      "MIMIT_DOWNLOAD_ERROR " +
        JSON.stringify({ resource: name, msg, code, causeCode }),
    );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new MimitSourceFetchError({
      resource: name,
      operation: "download",
      status: response.status,
    });
  }

  const declaredLength = parseContentLength(response.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`MIMIT ${name} CSV exceeds the download size limit.`);
  }

  if (!response.body) throw new Error(`MIMIT ${name} CSV response has no body.`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new Error(`MIMIT ${name} CSV exceeds the download size limit.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  return {
    name,
    url,
    text,
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
