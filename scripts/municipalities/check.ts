import { brotliCompressSync, constants, gzipSync } from "node:zlib";

import { MUNICIPALITY_CATALOG } from "../../src/generated/municipality-catalog";
import {
  createMunicipalitySearchIndex,
  searchMunicipalities,
  type MunicipalityCatalogDocument,
} from "../../src/domain/municipality-search";

const RAW_SIZE_LIMIT = 550_000;
const GZIP_SIZE_LIMIT = 170_000;
const BROTLI_SIZE_LIMIT = 135_000;

const catalogPath = `public${MUNICIPALITY_CATALOG.url}`;
const bytes = await Bun.file(catalogPath).bytes();
const document = JSON.parse(new TextDecoder().decode(bytes)) as MunicipalityCatalogDocument;
const gzipSize = gzipSync(bytes, { level: 9 }).byteLength;
const brotliSize = brotliCompressSync(bytes, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).byteLength;

if (bytes.byteLength > RAW_SIZE_LIMIT) {
  throw new Error(`Municipality catalog exceeds raw budget: ${bytes.byteLength}.`);
}
if (gzipSize > GZIP_SIZE_LIMIT) {
  throw new Error(`Municipality catalog exceeds gzip budget: ${gzipSize}.`);
}
if (brotliSize > BROTLI_SIZE_LIMIT) {
  throw new Error(`Municipality catalog exceeds Brotli budget: ${brotliSize}.`);
}
if (document.count !== MUNICIPALITY_CATALOG.count || document.items.length !== document.count) {
  throw new Error("Municipality catalog count does not match generated metadata.");
}

const index = createMunicipalitySearchIndex(document.items);
for (const [code, name] of document.items) {
  const result = searchMunicipalities(index, name, { limit: 20 });
  if (!result.some((municipality) => municipality.id === `municipality:${code}`)) {
    throw new Error(`Current municipality is not searchable by official name: ${code} ${name}.`);
  }
}

console.log(
  `Municipality catalog verified: ${document.count} searchable records; ` +
    `${bytes.byteLength} raw, ${gzipSize} gzip, ${brotliSize} Brotli bytes.`,
);
