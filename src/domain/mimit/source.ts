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
