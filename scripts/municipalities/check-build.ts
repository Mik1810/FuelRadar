import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { MUNICIPALITY_CATALOG } from "../../src/generated/municipality-catalog";
import type { MunicipalityCatalogDocument } from "../../src/domain/municipality-search";

export function containsTransformedCatalogPayload(
  built: Uint8Array,
  municipalityNames: readonly string[],
): boolean {
  const content = Buffer.from(built);
  let matches = 0;
  for (const name of municipalityNames) {
    const representations = [name, JSON.stringify(name).slice(1, -1)];
    if (representations.some((value) => content.includes(Buffer.from(value)))) {
      matches += 1;
    }
  }
  return matches >= 3;
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(path) : [path];
      }),
    )
  ).flat();
}

if (import.meta.main) {
  const catalogFile = Bun.file(`public${MUNICIPALITY_CATALOG.url}`);
  const catalog = (await catalogFile.json()) as MunicipalityCatalogDocument;
  const municipalityNames = [...catalog.items]
    .sort((left, right) => right[1].length - left[1].length)
    .slice(0, 8)
    .map((item) => item[1]);
  const buildFiles = [
    ...(await filesBelow(".next/static/chunks")),
    ...(await filesBelow(".next/server")),
  ].filter((path) => /\.(?:html|js|rsc)$/.test(path));

  for (const path of buildFiles) {
    const built = await Bun.file(path).bytes();
    if (containsTransformedCatalogPayload(built, municipalityNames)) {
      throw new Error(
        `Municipality catalog payload leaked into production artifact: ${path}`,
      );
    }
  }

  console.log(
    `Production bundle verified: catalog payload absent from ${buildFiles.length} artifacts.`,
  );
}
