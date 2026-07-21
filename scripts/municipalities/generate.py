#!/usr/bin/env python3
"""Download, validate and generate FuelRadar's static municipality catalog."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import tempfile
import urllib.request
import zipfile
from datetime import date
from pathlib import Path
from typing import Any

import openpyxl
import shapefile
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import unary_union

CATALOG_VERSION = 1
SOURCE_DATE = "2026-02-21"
BOUNDARIES_DATE = "2026-01-01"
EXPECTED_COUNT = 7_894
MUNICIPALITIES_URL = (
    "https://www.istat.it/storage/codici-unita-amministrative/"
    "Elenco-comuni-italiani.xlsx"
)
BOUNDARIES_URL = (
    "https://www.istat.it/storage/cartografia/confini_amministrativi/"
    "generalizzati/2026/Limiti01012026_g.zip"
)
SOURCE_FILENAMES = {
    MUNICIPALITIES_URL: "Elenco-comuni-italiani.xlsx",
    BOUNDARIES_URL: "Limiti01012026_g.zip",
}
SOURCE_SIZE_LIMITS = {
    MUNICIPALITIES_URL: 5_000_000,
    BOUNDARIES_URL: 30_000_000,
}
ZIP_MEMBER_LIMIT = 500
ZIP_EXPANDED_SIZE_LIMIT = 200_000_000
SHAPEFILE_MEMBER = re.compile(
    r"^Com[0-9A-Za-z_-]+_WGS84\.(?:cpg|dbf|prj|shp|shx)$",
    re.I,
)

# The current registry is newer than the annual boundary snapshot. These
# explicit dissolves are documented by ISTAT's 2026 administrative changes.
GEOMETRY_SOURCES = {
    "018094": ("018094", "018082"),  # Montalto Pavese incorporates Lirio
    "024129": ("024027", "024071"),  # Castegnero Nanto merger
}


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def download(url: str) -> tuple[bytes, dict[str, str]]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "FuelRadar municipality catalog generator"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        content = read_bounded_response(response, url)
        return content, {
            "lastModified": response.headers.get("Last-Modified", ""),
            "etag": response.headers.get("ETag", ""),
        }


def read_bounded_response(response: Any, url: str) -> bytes:
    limit = SOURCE_SIZE_LIMITS[url]
    content_length = response.headers.get("Content-Length")
    if content_length and int(content_length) > limit:
        raise ValueError(f"Official source exceeds size limit: {url}")
    content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError(f"Official source exceeds size limit: {url}")
    return content


def read_sources(offline_dir: Path | None) -> dict[str, tuple[bytes, dict[str, str]]]:
    sources: dict[str, tuple[bytes, dict[str, str]]] = {}
    for url, filename in SOURCE_FILENAMES.items():
        if offline_dir:
            sources[url] = ((offline_dir / filename).read_bytes(), {})
        else:
            sources[url] = download(url)
    return sources


def header_map(values: tuple[Any, ...]) -> dict[str, int]:
    return {
        str(value).replace("\n", " ").strip(): index
        for index, value in enumerate(values)
        if value is not None
    }


def load_municipalities(xlsx: bytes) -> list[dict[str, Any]]:
    with tempfile.NamedTemporaryFile(suffix=".xlsx") as source_file:
        source_file.write(xlsx)
        source_file.flush()
        workbook = openpyxl.load_workbook(
            source_file.name,
            read_only=True,
            data_only=True,
        )
        rows = workbook.active.iter_rows(values_only=True)
        headers = header_map(next(rows))
        required = {
            "code": "Codice Comune formato alfanumerico",
            "name": "Denominazione (Italiana e straniera)",
            "italianName": "Denominazione in italiano",
            "otherName": "Denominazione altra lingua",
            "region": "Denominazione Regione",
            "province": "Sigla automobilistica",
        }
        missing_headers = sorted(set(required.values()) - set(headers))
        if missing_headers:
            raise ValueError(f"Missing ISTAT columns: {missing_headers}")

        municipalities: list[dict[str, Any]] = []
        for row in rows:
            code_value = row[headers[required["code"]]]
            if code_value is None:
                continue
            code = str(code_value).strip().zfill(6)
            if not re.fullmatch(r"\d{6}", code):
                raise ValueError(f"Invalid ISTAT municipality code: {code!r}")
            name_value = row[headers[required["name"]]]
            province_value = row[headers[required["province"]]]
            region_value = row[headers[required["region"]]]
            name = "" if name_value is None else str(name_value).strip()
            province = "" if province_value is None else str(province_value).strip()
            region = "" if region_value is None else str(region_value).strip()
            if not name or len(name) > 160:
                raise ValueError(f"Invalid municipality name for {code}.")
            if not province or len(province) > 4:
                raise ValueError(f"Invalid province abbreviation for {code}.")
            if not region or len(region) > 80:
                raise ValueError(f"Invalid region name for {code}.")
            italian_name = str(row[headers[required["italianName"]]] or "").strip()
            other_name = str(row[headers[required["otherName"]]] or "").strip()
            aliases = [
                alias
                for alias in dict.fromkeys((italian_name, other_name))
                if alias and alias != name
            ]
            municipalities.append(
                {
                    "code": code,
                    "name": name,
                    "province": province,
                    "region": region,
                    "aliases": aliases,
                }
            )

    codes = [municipality["code"] for municipality in municipalities]
    if len(municipalities) != EXPECTED_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_COUNT} current municipalities, got {len(municipalities)}."
        )
    if len(set(codes)) != len(codes):
        raise ValueError("The ISTAT municipality list contains duplicate codes.")
    return sorted(municipalities, key=lambda municipality: municipality["code"])


def extract_boundary_members(archive: zipfile.ZipFile, extraction_root: Path) -> None:
    extraction_root = extraction_root.resolve()
    members = archive.infolist()
    if len(members) > ZIP_MEMBER_LIMIT:
        raise ValueError("Boundary archive has too many members.")
    if sum(member.file_size for member in members) > ZIP_EXPANDED_SIZE_LIMIT:
        raise ValueError("Boundary archive expands beyond the size limit.")
    selected_members = [
        member
        for member in members
        if SHAPEFILE_MEMBER.fullmatch(Path(member.filename).name)
    ]
    for member in selected_members:
        destination = (extraction_root / member.filename).resolve()
        if not destination.is_relative_to(extraction_root):
            raise ValueError(f"Unsafe path in boundary archive: {member.filename}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(member) as source, destination.open("wb") as target:
            shutil.copyfileobj(source, target)


def load_boundaries(boundaries_zip: bytes) -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as temporary_directory:
        archive_path = Path(temporary_directory) / "boundaries.zip"
        archive_path.write_bytes(boundaries_zip)
        with zipfile.ZipFile(archive_path) as archive:
            extract_boundary_members(archive, Path(temporary_directory))
        shapefiles = list(Path(temporary_directory).glob("**/Com*_WGS84.shp"))
        if len(shapefiles) != 1:
            raise ValueError(f"Expected one municipality shapefile, got {shapefiles}.")
        reader = shapefile.Reader(str(shapefiles[0]), encoding="utf-8")
        fields = [field[0] for field in reader.fields[1:]]
        if "PRO_COM_T" not in fields:
            raise ValueError("The boundary layer has no PRO_COM_T join key.")
        code_index = fields.index("PRO_COM_T")
        geometries: dict[str, Any] = {}
        for shape_record in reader.iterShapeRecords():
            code = str(shape_record.record[code_index]).strip().zfill(6)
            if code in geometries:
                raise ValueError(f"Duplicate boundary code: {code}")
            geometry = shape(shape_record.shape.__geo_interface__)
            if geometry.is_empty:
                raise ValueError(f"Empty boundary geometry: {code}")
            geometries[code] = geometry
        return geometries


def polygon_components(geometry: Any) -> list[Any]:
    if geometry.geom_type == "Polygon":
        return [geometry]
    if geometry.geom_type == "MultiPolygon":
        return list(geometry.geoms)
    if geometry.geom_type == "GeometryCollection":
        return [part for part in geometry.geoms if part.geom_type == "Polygon"]
    return []


def build_catalog(
    municipalities: list[dict[str, Any]], boundaries: dict[str, Any]
) -> dict[str, Any]:
    current_codes = {municipality["code"] for municipality in municipalities}
    used_boundary_codes: set[str] = set()
    transformer = Transformer.from_crs("EPSG:32632", "EPSG:4326", always_xy=True)
    items: list[list[Any]] = []

    for municipality in municipalities:
        code = municipality["code"]
        source_codes = GEOMETRY_SOURCES.get(code, (code,))
        missing_sources = [source for source in source_codes if source not in boundaries]
        if missing_sources:
            raise ValueError(f"Missing boundary geometry for {code}: {missing_sources}")
        used_boundary_codes.update(source_codes)
        dissolved = unary_union([boundaries[source] for source in source_codes])
        components = polygon_components(dissolved)
        if not components:
            raise ValueError(f"No polygon component for municipality {code}.")
        main_polygon = max(components, key=lambda polygon: polygon.area)
        point = main_polygon.representative_point()
        if not main_polygon.covers(point):
            raise ValueError(f"Representative point lies outside municipality {code}.")
        longitude, latitude = transformer.transform(point.x, point.y)
        if not (
            math.isfinite(latitude)
            and math.isfinite(longitude)
            and 35 <= latitude <= 48
            and 6 <= longitude <= 19
        ):
            raise ValueError(f"Invalid WGS84 coordinate for {code}: {latitude}, {longitude}")
        item: list[Any] = [
            code,
            municipality["name"],
            municipality["province"],
            municipality["region"],
            round(latitude, 6),
            round(longitude, 6),
        ]
        if municipality["aliases"]:
            item.append(municipality["aliases"])
        items.append(item)

    unused_boundaries = set(boundaries) - used_boundary_codes
    unexpected_current = current_codes - set(boundaries) - set(GEOMETRY_SOURCES)
    if unexpected_current or unused_boundaries:
        raise ValueError(
            "Unreviewed registry/boundary mismatch: "
            f"missing={sorted(unexpected_current)}, extra={sorted(unused_boundaries)}"
        )
    return {
        "v": CATALOG_VERSION,
        "sourceDate": SOURCE_DATE,
        "count": len(items),
        "items": items,
    }


def compact_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8") + b"\n"


def generated_module(filename: str, digest: str) -> str:
    return f'''// Generated by scripts/municipalities/generate.py. Do not edit.
export const MUNICIPALITY_CATALOG = {{
  url: "/data/{filename}",
  version: {CATALOG_VERSION},
  count: {EXPECTED_COUNT},
  sourceDate: "{SOURCE_DATE}",
  sha256: "{digest}",
}} as const;
'''


def manifest(
    sources: dict[str, tuple[bytes, dict[str, str]]],
    catalog_digest: str,
    filename: str,
) -> dict[str, Any]:
    return {
        "version": CATALOG_VERSION,
        "retrievedAt": date.today().isoformat(),
        "registryReferenceDate": SOURCE_DATE,
        "boundariesReferenceDate": BOUNDARIES_DATE,
        "expectedMunicipalityCount": EXPECTED_COUNT,
        "sources": [
            {
                "url": url,
                "filename": SOURCE_FILENAMES[url],
                "sha256": sha256(content),
                **{key: value for key, value in metadata.items() if value},
            }
            for url, (content, metadata) in sources.items()
        ],
        "geometrySources": {
            code: list(source_codes)
            for code, source_codes in GEOMETRY_SOURCES.items()
        },
        "transformation": (
            "Dissolve reviewed predecessor geometries in EPSG:32632; choose the "
            "largest polygon component; compute point_on_surface; transform to "
            "EPSG:4326; round to six decimals."
        ),
        "catalog": {"filename": filename, "sha256": catalog_digest},
    }


def generate(sources: dict[str, tuple[bytes, dict[str, str]]]) -> tuple[bytes, str, str, dict[str, Any]]:
    municipalities = load_municipalities(sources[MUNICIPALITIES_URL][0])
    boundaries = load_boundaries(sources[BOUNDARIES_URL][0])
    catalog_bytes = compact_json(build_catalog(municipalities, boundaries))
    digest = sha256(catalog_bytes)
    filename = f"municipalities-{SOURCE_DATE}.{digest[:12]}.json"
    return catalog_bytes, filename, digest, manifest(sources, digest, filename)


def write_outputs(
    repository: Path,
    catalog_bytes: bytes,
    filename: str,
    digest: str,
    source_manifest: dict[str, Any],
) -> None:
    data_directory = repository / "public" / "data"
    module_path = repository / "src" / "generated" / "municipality-catalog.ts"
    manifest_path = repository / "data" / "municipalities" / "sources.json"
    data_directory.mkdir(parents=True, exist_ok=True)
    module_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    (data_directory / filename).write_bytes(catalog_bytes)
    module_path.write_text(generated_module(filename, digest))
    manifest_path.write_text(json.dumps(source_manifest, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--offline-dir", type=Path)
    parser.add_argument(
        "--repository",
        type=Path,
        default=Path(__file__).resolve().parents[2],
    )
    arguments = parser.parse_args()
    repository = arguments.repository.resolve()
    sources = read_sources(arguments.offline_dir)
    catalog_bytes, filename, digest, source_manifest = generate(sources)
    data_directory = repository / "public" / "data"
    module_path = repository / "src" / "generated" / "municipality-catalog.ts"
    manifest_path = repository / "data" / "municipalities" / "sources.json"
    catalog_path = data_directory / filename

    if arguments.check:
        if not catalog_path.exists() or catalog_path.read_bytes() != catalog_bytes:
            raise SystemExit("Committed municipality catalog is missing or stale.")
        if not module_path.exists() or module_path.read_text() != generated_module(filename, digest):
            raise SystemExit("Generated municipality metadata is stale.")
        committed_manifest = json.loads(manifest_path.read_text())
        deterministic_keys = (
            "version",
            "registryReferenceDate",
            "boundariesReferenceDate",
            "expectedMunicipalityCount",
            "geometrySources",
            "transformation",
            "catalog",
        )
        for key in deterministic_keys:
            if committed_manifest.get(key) != source_manifest[key]:
                raise SystemExit(f"Source manifest field is stale: {key}")
        for source in source_manifest["sources"]:
            committed = next(
                (item for item in committed_manifest["sources"] if item["url"] == source["url"]),
                None,
            )
            if not committed or any(
                committed.get(key) != source[key]
                for key in ("url", "filename", "sha256")
            ):
                raise SystemExit(f"Source checksum changed: {source['url']}")
        print(f"Municipality catalog is current: {EXPECTED_COUNT} records, {digest}.")
        return

    write_outputs(repository, catalog_bytes, filename, digest, source_manifest)
    print(f"Generated {catalog_path.relative_to(repository)} with {EXPECTED_COUNT} municipalities.")


if __name__ == "__main__":
    main()
