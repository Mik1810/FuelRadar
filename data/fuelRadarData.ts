import type { FuelType, GasStation } from "@/context/FuelContext";

export type ServiceMode = "self" | "served";

export type FuelRadarStation = {
  id: string;
  name: string;
  brand: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
};

export type FuelRadarPrice = {
  stationId: string;
  fuelType: FuelType;
  serviceMode: ServiceMode;
  price: number;
  communicatedAt: string;
};

export type FuelRadarDataset = {
  extractionDate: string;
  stations: FuelRadarStation[];
  prices: FuelRadarPrice[];
};

export function fuelRadarDatasetFromGasStations(
  stations: GasStation[],
  extractionDate: string
): FuelRadarDataset {
  return {
    extractionDate,
    stations: stations.map((station) => ({
      id: station.id,
      name: station.name,
      brand: station.brand,
      address: station.address,
      city: station.city,
      latitude: station.latitude,
      longitude: station.longitude,
    })),
    prices: stations.flatMap((station) =>
      station.prices.flatMap((price) => {
        const rows: FuelRadarPrice[] = [
          {
            stationId: station.id,
            fuelType: price.type,
            serviceMode: "self",
            price: price.selfService,
            communicatedAt: station.lastUpdated,
          },
        ];

        if (price.served !== undefined) {
          rows.push({
            stationId: station.id,
            fuelType: price.type,
            serviceMode: "served",
            price: price.served,
            communicatedAt: station.lastUpdated,
          });
        }

        return rows;
      })
    ),
  };
}

export function gasStationsFromFuelRadarDataset(dataset: FuelRadarDataset): GasStation[] {
  return dataset.stations.map((station) => {
    const pricesForStation = dataset.prices.filter((price) => price.stationId === station.id);
    const latestCommunication = pricesForStation
      .map((price) => price.communicatedAt)
      .sort()
      .at(-1);

    const pricesByFuel = new Map<FuelType, { selfService?: number; served?: number }>();

    for (const price of pricesForStation) {
      const current = pricesByFuel.get(price.fuelType) ?? {};
      if (price.serviceMode === "self") {
        current.selfService = price.price;
      } else {
        current.served = price.price;
      }
      pricesByFuel.set(price.fuelType, current);
    }

    return {
      ...station,
      prices: [...pricesByFuel.entries()]
        .filter(([, price]) => price.selfService !== undefined)
        .map(([type, price]) => ({
          type,
          selfService: price.selfService ?? 0,
          served: price.served,
        })),
      isFavorite: false,
      lastUpdated: latestCommunication ?? dataset.extractionDate,
    };
  });
}
