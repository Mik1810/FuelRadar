# Italian municipality catalog

FuelRadar searches municipalities entirely in the browser. The application
downloads a compact, content-addressed JSON catalog only after the user enters
at least two searchable characters. No third-party geocoding service is called
at runtime.

## Official sources and attribution

The catalog is derived from these ISTAT sources:

- [current Italian municipality registry](https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.xlsx),
  reference date 2026-02-21;
- [generalized administrative boundaries](https://www.istat.it/storage/cartografia/confini_amministrativi/generalizzati/2026/Limiti01012026_g.zip),
  reference date 2026-01-01.

ISTAT data is reused under the [Creative Commons Attribution 4.0
license](https://creativecommons.org/licenses/by/4.0/). Source URLs,
checksums, HTTP metadata and the exact transformation are recorded in
`data/municipalities/sources.json` for reproducibility.

The annual boundary snapshot precedes two changes in the current registry. The
generator explicitly and only accepts these reviewed differences:

- Montalto Pavese (`018094`) includes the former Lirio geometry (`018082`);
- Castegnero Nanto (`024129`) combines Castegnero (`024027`) and Nanto
  (`024071`).

Any other registry/boundary mismatch stops generation.

## Coordinates and format

Coordinates are reproducible representative points, not town halls or postal
addresses. For each municipality the generator dissolves reviewed predecessor
geometries, chooses the largest polygon component, calculates a point on its
surface in EPSG:32632, converts it to EPSG:4326 and rounds to six decimals. The
point is therefore suitable as the center of a nearby-station search and cannot
fall in a detached island or outside the selected polygon.

The compact document has version, source date, count and tuple items:

```text
[ISTAT code, official name, province abbreviation, region, latitude, longitude, optional aliases]
```

Province and region remain visible so homonyms such as Castro (BG) and Castro
(LE) can be distinguished. Search normalization ignores case, accents,
apostrophe variants, punctuation and whitespace. Exact, compact, prefix and
ordered token-prefix matches are ranked deterministically.

The browser-facing provider contract lives in `src/domain/geocoding.ts`, so a
future address or neighborhood provider can extend the result union without
changing municipality search.

## Updating and checking

Requirements are Bun and [uv](https://docs.astral.sh/uv/). The generator's
Python 3.12 runtime and complete dependency graph are pinned by
`scripts/municipalities/pyproject.toml` and `scripts/municipalities/uv.lock`;
uv downloads the runtime when necessary.

```bash
bun run municipalities:update
bun run municipalities:check
```

Update downloads both official sources, validates the expected 7,894 current
municipalities and emits a content-hashed file under `public/data`, generated
TypeScript metadata and the source manifest. Older hashed catalogs are retained
so tabs opened across a deployment can still finish their lazy request. Check independently regenerates
the output, compares source checksums, verifies every official name is
searchable, and enforces raw, gzip and Brotli size budgets. The hashed asset is
served with an immutable one-year cache policy; it is never imported into the
initial JavaScript bundle.
