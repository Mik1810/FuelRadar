export const FUEL_TYPES = ["benzina", "diesel", "gpl", "metano"] as const;

export type FuelType = (typeof FUEL_TYPES)[number];

export const SERVICE_MODES = ["self", "served"] as const;

export type ServiceMode = (typeof SERVICE_MODES)[number];
