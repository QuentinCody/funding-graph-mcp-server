"""Behavioral tests for complete, lossless, atomic EURIO snapshot imports."""
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from eurio_archive import download, load_manifest
from eurio_bulk import import_archive

URL = "https://cordis.europa.eu/data/cordis-organisationNamedGraph-nq.zip"
NQ = ('<https://example.org/s> <https://example.org/p> "001"^^<http://www.w3.org/2001/XMLSchema#integer> <https://example.org/g> .\n'
      '_:native <https://example.org/p> "Καλημέρα\\nquote\\\""@el <https://example.org/g> .\n'
      '_:native <https://example.org/link> <https://example.org/s> _:graph .\n'
      '<https://example.org/s> <https://example.org/p> "default" .\n')


class BulkTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def fixture(self, members=None):
        path = self.root / "source.zip"
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
            for name, raw in (members or {"extract/a.nq": NQ, "extract/ametadata.xml": '<metadata date="2026-09-22"/>'}).items():
                archive.writestr(name, raw)
        self.sha = hashlib.sha256(path.read_bytes()).hexdigest()
        self.manifest = self.root / "manifest.json"
        self.manifest.write_text(json.dumps({"format_version": "eurio-dump-manifest-1", "distribution_id": "fixture",
            "native_distribution": {"id": "fixture", "download_url": [URL], "modified": "2026-09-29"},
            "artifact": {"url": URL, "bytes": path.stat().st_size, "etag": '"fixture"', "last_modified": "2026-09-22"}}))
        return path

    def run_import(self, source, **kwargs):
        return import_archive(source, self.manifest, self.root / "out.sqlite", self.sha, **kwargs)

    def test_preserves_lexical_terms_graphs_original_lines_and_metadata(self):
        source = self.fixture({"one.nq": NQ + NQ.splitlines(keepends=True)[0], "two.nq": '_:native <https://example.org/p> "other member" .\n', "onemetadata.xml": b'<m>native</m>'})
        result = self.run_import(source)
        self.assertEqual(result["quad_occurrences"], 6)
        self.assertTrue(result["complete_archive_scan"])
        with sqlite3.connect(self.root / "out.sqlite") as db:
            rows = db.execute("SELECT object, datatype FROM quads WHERE datatype IS NOT NULL").fetchall()
            self.assertEqual(rows, [("001", "http://www.w3.org/2001/XMLSchema#integer")] * 2)
            self.assertEqual(db.execute("SELECT object, language FROM quads WHERE language IS NOT NULL").fetchone(), ('Καλημέρα\nquote"', "el"))
            self.assertEqual(db.execute("SELECT graph_kind, graph FROM quads WHERE graph_kind='bnode'").fetchone(), ("bnode", "graph"))
            self.assertEqual(db.execute("SELECT count(DISTINCT member_id) FROM quads WHERE subject='native'").fetchone()[0], 2)
            self.assertEqual(db.execute("SELECT raw_metadata FROM files WHERE format='metadata_xml'").fetchone()[0], b'<m>native</m>')
            self.assertEqual(db.execute("SELECT raw_nquad FROM quads WHERE member_id=1 ORDER BY line_number LIMIT 1").fetchone()[0], NQ.splitlines(keepends=True)[0])
            self.assertEqual(db.execute("SELECT sha256 FROM files WHERE name='one.nq'").fetchone()[0], hashlib.sha256((NQ + NQ.splitlines(keepends=True)[0]).encode()).hexdigest())
            self.assertEqual(json.loads(db.execute("SELECT manifest_json FROM snapshot").fetchone()[0])["native_distribution"]["modified"], "2026-09-29")

    def test_rejects_wrong_pin_without_publishing(self):
        source = self.fixture()
        self.sha = "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self.run_import(source)
        self.assertFalse((self.root / "out.sqlite").exists())

    def test_malformed_rdf_after_valid_rows_is_not_a_partial_success(self):
        source = self.fixture({"a.nq": NQ + '<https://example.org/s> invalid .\n'})
        with self.assertRaises(Exception):
            self.run_import(source)
        self.assertFalse((self.root / "out.sqlite").exists())
        self.assertEqual(list(self.root.glob('.eurio-import-*')), [])

    def test_rejects_crc_corruption_even_with_a_matching_archive_hash(self):
        source = self.fixture()
        raw = source.read_bytes().replace(b'"001"', b'"002"', 1)
        source.write_bytes(raw)
        self.sha = hashlib.sha256(raw).hexdigest()
        with self.assertRaises(zipfile.BadZipFile):
            self.run_import(source)
        self.assertFalse((self.root / "out.sqlite").exists())

    def test_enforces_line_and_total_limits(self):
        source = self.fixture()
        for options in [{"max_total_bytes": 1}, {"max_line_bytes": 8}]:
            with self.assertRaisesRegex(ValueError, "byte limit"):
                self.run_import(source, **options)
        self.assertFalse((self.root / "out.sqlite").exists())

    def test_rejects_unsafe_and_unknown_members(self):
        for name in ["../a.nq", "a.json", "/absolute.nq"]:
            source = self.fixture({name: NQ})
            with self.assertRaisesRegex(ValueError, "member"):
                self.run_import(source)
        self.assertFalse((self.root / "out.sqlite").exists())

    def test_never_overwrites_existing_snapshot(self):
        source = self.fixture()
        output = self.root / "out.sqlite"
        output.write_bytes(b"keep")
        with self.assertRaises(FileExistsError):
            self.run_import(source)
        self.assertEqual(output.read_bytes(), b"keep")

    def test_download_pins_headers_and_publishes_only_the_complete_archive(self):
        source = self.fixture()
        body = source.read_bytes()
        response = io.BytesIO(body)
        response.status = 200
        response.headers = {"ETag": '"fixture"', "Content-Length": str(len(body))}
        with patch("urllib.request.build_opener") as opener:
            opener.return_value.open.return_value = response
            result = download(self.manifest, self.root / 'download.zip')
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header('If-match'), '"fixture"')
        self.assertEqual(result['archive_sha256'], self.sha)
        self.assertFalse(result['provider_checksum_verified'])
        self.assertEqual((self.root / 'download.zip').read_bytes(), body)

    def test_truncated_or_changed_downloads_never_publish(self):
        source = self.fixture()
        body = source.read_bytes()
        for etag, content in [('"other"', body), ('"fixture"', body[:-1])]:
            response = io.BytesIO(content)
            response.status = 200
            response.headers = {"ETag": etag, "Content-Length": str(len(body))}
            with patch("urllib.request.build_opener") as opener:
                opener.return_value.open.return_value = response
                with self.assertRaises(ValueError):
                    download(self.manifest, self.root / 'download.zip')
            self.assertFalse((self.root / 'download.zip').exists())

    def test_rejects_untrusted_url_or_weak_validator(self):
        self.fixture()
        original = self.manifest.read_text()
        for before, after in [('https://cordis.europa.eu', 'https://example.org'), ('"etag": "\\"fixture\\""', '"etag": "W/\\"fixture\\""')]:
            self.manifest.write_text(original.replace(before, after))
            with self.assertRaises(ValueError):
                load_manifest(self.manifest)


if __name__ == "__main__":
    unittest.main()
