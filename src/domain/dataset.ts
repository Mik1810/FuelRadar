import type { FuelType, ServiceMode } from "@/domain/fuel";

export type FuelRadarStation = {
  id: string;
  operator: string;
  brand: string;
  stationType: string;
  name: string;
  address: string;
  city: string;
  province: string;
  latitude: number;
  longitude: number;
};

export type FuelRadarPrice = {
  stationId: string;
  fuelType: FuelType;
  serviceMode: ServiceMode;
  price: number;
  /** MIMIT local civil time, normalized as YYYY-MM-DDTHH:mm:ss. */
  communicatedAt: string;
};

export type FuelRadarDatasetMetadata = {
  stationsExtractionDate: string;
  pricesExtractionDate: string;
};

export type FuelRadarDataset = {
  extractionDate: string;
  metadata: FuelRadarDatasetMetadata;
  stations: FuelRadarStation[];
  prices: FuelRadarPrice[];
};
