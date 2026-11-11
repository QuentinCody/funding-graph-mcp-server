#!/usr/bin/env python3
"""Download pinned EURIO ZIPs or import a verified N-Quads snapshot into local SQLite."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import stat
import sys
import tempfile
from zipfile import ZipFile
from eurio_archive import digest_file, download, load_manifest
from eurio_nquads import import_member

SCHEMA = """
CREATE TABLE snapshot (archive_sha256 TEXT NOT NULL, manifest_sha256 TEXT NOT NULL,
  source_url TEXT NOT NULL, imported_at TEXT NOT NULL, manifest_json BLOB NOT NULL,
  parser_version TEXT NOT NULL, complete_archive_scan INTEGER NOT NULL,
  members INTEGER NOT NULL, quad_occurrences INTEGER NOT NULL, uncompressed_bytes INTEGER NOT NULL);
CREATE TABLE files (member_id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
  format TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
  crc32 TEXT NOT NULL, quad_occurrences INTEGER NOT NULL, raw_metadata BLOB);
CREATE TABLE quads (member_id INTEGER NOT NULL REFERENCES files(member_id), line_number INTEGER NOT NULL,
  subject_kind TEXT NOT NULL, subject TEXT NOT NULL, predicate TEXT NOT NULL,
  object_kind TEXT NOT NULL, object TEXT NOT NULL, language TEXT, datatype TEXT,
  graph_kind TEXT NOT NULL, graph TEXT, raw_nquad TEXT NOT NULL);
"""


def checked_entries(archive, max_total_bytes):
    entries = archive.infolist()
    if not entries or len(entries) > 1000 or len({entry.filename for entry in entries}) != len(entries):
        raise ValueError("Invalid or duplicate ZIP members")
    if sum(entry.file_size for entry in entries) > max_total_bytes:
        raise ValueError("Archive exceeds uncompressed byte limit")
    formats = []
    for info in entries:
        path = PurePosixPath(info.filename)
        if path.is_absolute() or ".." in path.parts or "\\" in info.filename or info.is_dir() or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
            raise ValueError("Unsafe or unsupported ZIP member")
        kind = "nquads" if info.filename.endswith(".nq") else "metadata_xml" if info.filename.lower().endswith("metadata.xml") else None
        if kind is None:
            raise ValueError(f"Unexpected archive member: {info.filename}")
        formats.append((info, kind))
    if not any(kind == "nquads" for _, kind in formats):
        raise ValueError("Archive contains no N-Quads member")
    return formats


def populate(db, source, manifest, raw_manifest, manifest_hash, archive_hash, max_total_bytes, max_line_bytes, progress):
    db.executescript(SCHEMA)
    total_bytes, total_quads = 0, 0
    with ZipFile(source) as archive:
        entries = checked_entries(archive, max_total_bytes)
        for member_id, (info, kind) in enumerate(entries, 1):
            metadata = None
            if kind == "nquads":
                digest, size, count = import_member(db, archive, info, member_id, max_line_bytes, progress)
            else:
                if info.file_size > 16 * 1024 * 1024:
                    raise ValueError("XML metadata exceeds 16 MiB")
                with archive.open(info) as member:
                    metadata = member.read(16 * 1024 * 1024 + 1)
                if len(metadata) != info.file_size:
                    raise ValueError("Invalid metadata member size")
                digest, size, count = hashlib.sha256(metadata).hexdigest(), len(metadata), 0
            db.execute("INSERT INTO files VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                       (member_id, info.filename, kind, digest, size, f"{info.CRC:08x}", count, metadata))
            total_bytes += size
            total_quads += count
    # The same descriptor is hashed before and after parsing; path replacement cannot retarget it.
    if digest_file(source) != archive_hash:
        raise ValueError("Archive changed during import")
    db.executescript("""
      CREATE INDEX quads_subject ON quads(subject_kind, subject);
      CREATE INDEX quads_predicate ON quads(predicate);
      CREATE INDEX quads_uri_object ON quads(object) WHERE object_kind = 'uri';
    """)
    db.execute("INSERT INTO snapshot VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
               (archive_hash, manifest_hash, manifest["artifact"]["url"], datetime.now(timezone.utc).isoformat(),
                raw_manifest, "rdflib-7.6.0", len(entries), total_quads, total_bytes))
    db.commit()
    return {"archive_sha256": archive_hash, "manifest_sha256": manifest_hash, "members": len(entries),
            "quad_occurrences": total_quads, "uncompressed_bytes": total_bytes, "complete_archive_scan": True,
            "scope": "This pinned ZIP only; quad occurrences are not distinct entities or complete live EURIO coverage."}


def import_archive(archive_path, manifest_path, output, expected_sha256,
                   max_total_bytes=8 * 1024 * 1024 * 1024, max_line_bytes=1024 * 1024, progress=None):
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("Expected lowercase archive SHA-256")
    if max_total_bytes < 1 or max_line_bytes < 1:
        raise ValueError("Byte limits must be positive")
    manifest, raw_manifest, manifest_hash = load_manifest(manifest_path)
    if not manifest["artifact"]["url"].endswith("-nq.zip"):
        raise ValueError("SQLite import requires an N-Quads distribution")
    output = Path(output)
    if output.exists():
        raise FileExistsError("Refusing to overwrite a snapshot")
    with open(archive_path, "rb") as source:
        if os.fstat(source.fileno()).st_size != manifest["artifact"]["bytes"] or digest_file(source) != expected_sha256:
            raise ValueError("Archive size or SHA-256 mismatch")
        fd, temporary = tempfile.mkstemp(prefix=".eurio-import-", suffix=".sqlite", dir=output.parent)
        os.close(fd)
        try:
            with closing(sqlite3.connect(temporary)) as db:
                result = populate(db, source, manifest, raw_manifest, manifest_hash, expected_sha256,
                                  max_total_bytes, max_line_bytes, progress)
            os.link(temporary, output)
            return {**result, "snapshot": str(output)}
        finally:
            for candidate in [temporary, temporary + "-journal"]:
                Path(candidate).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    acquire = commands.add_parser("download", help="Download with manifest If-Match and compute a SHA-256")
    acquire.add_argument("--manifest", type=Path, required=True)
    acquire.add_argument("--output", type=Path, required=True)
    acquire.add_argument("--max-bytes", type=int, default=1024 * 1024 * 1024)
    ingest = commands.add_parser("import", help="Stream a complete SHA-256-pinned N-Quads ZIP into SQLite")
    ingest.add_argument("--archive", type=Path, required=True)
    ingest.add_argument("--manifest", type=Path, required=True)
    ingest.add_argument("--output", type=Path, required=True)
    ingest.add_argument("--sha256", required=True)
    ingest.add_argument("--max-uncompressed-bytes", type=int, default=8 * 1024 * 1024 * 1024)
    ingest.add_argument("--max-line-bytes", type=int, default=1024 * 1024)
    args = parser.parse_args()
    if args.operation == "download":
        result = download(args.manifest, args.output, args.max_bytes)
    else:
        result = import_archive(args.archive, args.manifest, args.output, args.sha256,
                                args.max_uncompressed_bytes, args.max_line_bytes,
                                progress=lambda value: print(json.dumps(value), file=sys.stderr, flush=True))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
