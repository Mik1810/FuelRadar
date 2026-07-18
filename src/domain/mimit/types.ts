export const MIMIT_RESOURCE_NAMES = ["stations", "prices"] as const;

export type MimitResourceName = (typeof MIMIT_RESOURCE_NAMES)[number];

export type MimitCsvData = {
  resource: MimitResourceName;
  extractionDate: string;
  headers: string[];
  rows: string[][];
  recoveredRows: number;
};
