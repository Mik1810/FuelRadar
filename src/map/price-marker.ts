import type { FuelType, ServiceMode } from "@/domain/fuel";

export type MapPosition = {
  readonly latitude: number;
  readonly longitude: number;
};

export type PriceMarkerInput = {
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly name: string;
  readonly address: string;
  readonly price: number;
  readonly fuelType: FuelType;
  readonly serviceMode: ServiceMode;
  readonly distanceKm?: number;
};

export type PriceMarker = Readonly<
  PriceMarkerInput & {
    readonly position: MapPosition;
  }
>;

const priceFormatter = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

export function formatFuelPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "Prezzo non disponibile";
  return `${priceFormatter.format(price)}/L`;
}

function validCoordinates(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/** Converts validated station data into the map-only marker contract. */
export function createPriceMarker(input: PriceMarkerInput): PriceMarker | null {
  if (
    input.id.trim().length === 0 ||
    input.name.trim().length === 0 ||
    !validCoordinates(input.latitude, input.longitude) ||
    !Number.isFinite(input.price) ||
    input.price <= 0 ||
    (input.distanceKm !== undefined &&
      (!Number.isFinite(input.distanceKm) || input.distanceKm < 0))
  ) {
    return null;
  }
  return {
    ...input,
    position: { latitude: input.latitude, longitude: input.longitude },
  };
}
