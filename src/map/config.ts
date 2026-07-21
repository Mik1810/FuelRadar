export type MapAttributionLink = {
  readonly label: string;
  readonly href: string;
};

export type TileProvider = {
  readonly id: string;
  readonly url: string;
  readonly attribution: readonly MapAttributionLink[];
  readonly minZoom: number;
  readonly maxZoom: number;
};

/**
 * The default is deliberately a small, policy-compliant OSM tile setup. Swap
 * this object at the application boundary when a production tile provider is
 * selected; map components receive their provider through props.
 */
export const OPENSTREETMAP_TILE_PROVIDER: TileProvider = Object.freeze({
  id: "openstreetmap",
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: Object.freeze([
    Object.freeze({
      label: "© OpenStreetMap contributors",
      href: "https://www.openstreetmap.org/copyright",
    }),
  ]),
  minZoom: 0,
  maxZoom: 19,
});

function isText(value: string): boolean {
  return value.trim().length > 0;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/** Validates provider configuration before it reaches Leaflet. */
export function validateTileProvider(provider: TileProvider): TileProvider {
  if (!isText(provider.id)) throw new Error("Tile provider id is required.");
  if (
    !isHttpsUrl(provider.url) ||
    !["{z}", "{x}", "{y}"].every((token) => provider.url.includes(token))
  ) {
    throw new Error("Tile provider URL must be HTTPS and contain {z}, {x}, and {y}.");
  }
  if (
    !Number.isInteger(provider.minZoom) ||
    !Number.isInteger(provider.maxZoom) ||
    provider.minZoom < 0 ||
    provider.maxZoom > 22 ||
    provider.minZoom > provider.maxZoom
  ) {
    throw new Error("Tile provider zoom limits are invalid.");
  }
  if (
    provider.attribution.length === 0 ||
    provider.attribution.some(
      (link) => !isText(link.label) || !isHttpsUrl(link.href),
    )
  ) {
    throw new Error("Tile provider needs visible HTTPS attribution links.");
  }
  return provider;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>\"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

/** Leaflet's attribution control accepts HTML, so escape configured text first. */
export function tileAttributionHtml(provider: TileProvider): string {
  return validateTileProvider(provider)
    .attribution.map(
      ({ label, href }) =>
        `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    )
    .join(" · ");
}
