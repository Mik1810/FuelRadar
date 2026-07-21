import io
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import openpyxl

from generate import (
    BOUNDARIES_URL,
    extract_boundary_members,
    load_municipalities,
    read_bounded_response,
    write_outputs,
)


class WriteOutputsTest(unittest.TestCase):
    def test_retains_previous_content_addressed_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            repository = Path(temporary_directory)
            data_directory = repository / "public" / "data"
            data_directory.mkdir(parents=True)
            previous = data_directory / "municipalities-2025-01-01.0123456789ab.json"
            previous.write_bytes(b"previous catalog\n")

            write_outputs(
                repository,
                b"current catalog\n",
                "municipalities-2026-02-21.abcdef012345.json",
                "abcdef012345" + "0" * 52,
                {"sources": []},
            )

            self.assertEqual(previous.read_bytes(), b"previous catalog\n")
            self.assertEqual(
                (
                    data_directory
                    / "municipalities-2026-02-21.abcdef012345.json"
                ).read_bytes(),
                b"current catalog\n",
            )


class BoundaryArchiveTest(unittest.TestCase):
    @staticmethod
    def archive_bytes(entries: dict[str, bytes]) -> bytes:
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, content in entries.items():
                archive.writestr(name, content)
        return output.getvalue()

    def extract(self, value: bytes, target: Path) -> None:
        with zipfile.ZipFile(io.BytesIO(value)) as archive:
            extract_boundary_members(archive, target)

    def test_extracts_only_required_sidecars(self) -> None:
        value = self.archive_bytes(
            {
                "layer/Com01012026_g_WGS84.shp": b"shape",
                "layer/Com01012026_g_WGS84.dbf": b"records",
                "unrelated/readme.txt": b"ignored",
            }
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory)
            self.extract(value, target)
            self.assertTrue((target / "layer/Com01012026_g_WGS84.shp").exists())
            self.assertFalse((target / "unrelated/readme.txt").exists())

    def test_rejects_traversal(self) -> None:
        value = self.archive_bytes({"../../Com01012026_g_WGS84.shp": b"shape"})
        with tempfile.TemporaryDirectory() as temporary_directory:
            with self.assertRaisesRegex(ValueError, "Unsafe path"):
                self.extract(value, Path(temporary_directory))

    def test_rejects_member_and_expanded_size_limits(self) -> None:
        many = self.archive_bytes({"one": b"1", "two": b"2"})
        large = self.archive_bytes({"Com01012026_g_WGS84.shp": b"1234"})
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory)
            with patch("generate.ZIP_MEMBER_LIMIT", 1):
                with self.assertRaisesRegex(ValueError, "too many members"):
                    self.extract(many, target)
            with patch("generate.ZIP_EXPANDED_SIZE_LIMIT", 3):
                with self.assertRaisesRegex(ValueError, "size limit"):
                    self.extract(large, target)


class SourceValidationTest(unittest.TestCase):
    def test_rejects_oversized_download_with_and_without_content_length(self) -> None:
        class Response(io.BytesIO):
            def __init__(self, content: bytes, content_length: str | None = None):
                super().__init__(content)
                self.headers = {"Content-Length": content_length} if content_length else {}

        with patch("generate.SOURCE_SIZE_LIMITS", {BOUNDARIES_URL: 3}):
            with self.assertRaisesRegex(ValueError, "size limit"):
                read_bounded_response(Response(b"1234"), BOUNDARIES_URL)
            with self.assertRaisesRegex(ValueError, "size limit"):
                read_bounded_response(Response(b"", "4"), BOUNDARIES_URL)

    def test_rejects_missing_required_registry_labels(self) -> None:
        headers = [
            "Codice Comune formato alfanumerico",
            "Denominazione (Italiana e straniera)",
            "Denominazione in italiano",
            "Denominazione altra lingua",
            "Denominazione Regione",
            "Sigla automobilistica",
        ]
        valid = ["001001", "Agliè", "Agliè", None, "Piemonte", "TO"]
        for index, expected in ((1, "name"), (4, "region"), (5, "province")):
            workbook = openpyxl.Workbook()
            worksheet = workbook.active
            worksheet.append(headers)
            row = valid.copy()
            row[index] = None
            worksheet.append(row)
            output = io.BytesIO()
            workbook.save(output)

            with self.subTest(field=expected), patch("generate.EXPECTED_COUNT", 1):
                with self.assertRaisesRegex(ValueError, expected):
                    load_municipalities(output.getvalue())


if __name__ == "__main__":
    unittest.main()
