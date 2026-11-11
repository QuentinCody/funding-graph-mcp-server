"""Pinned EURIO archive acquisition; no redirects or archive extraction."""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.request

URL_PATTERN = r"https://cordis\.europa\.eu/data/cordis-(?:projectNamedGraph|organisationNamedGraph|resultNamedGraph|EURIOKnowledgeGraph)-(?:nq|n3|ttl|rdf|jsonld)\.zip"


def load_manifest(path):
    with open(path, "rb") as source:
        raw = source.read(4 * 1024 * 1024 + 1)
    if len(raw) > 4 * 1024 * 1024:
        raise ValueError("Manifest exceeds 4 MiB")
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get("artifact"), dict) or not isinstance(data.get("native_distribution"), dict):
        raise ValueError("Invalid dump manifest structure")
    artifact = data.get("artifact", {})
    if data.get("format_version") != "eurio-dump-manifest-1":
        raise ValueError("Expected a recovered eurio-dump-manifest-1 object")
    if not re.fullmatch(URL_PATTERN, str(artifact.get("url", ""))):
        raise ValueError("Expected an official EURIO archive URL")
    size = artifact.get("bytes")
    if type(size) is not int or size < 1:
        raise ValueError("Manifest must pin a positive integer byte size")
    if not re.fullmatch(r'"[^"\r\n]+"', str(artifact.get("etag", ""))):
        raise ValueError("Manifest must pin a strong ETag")
    distribution = data.get("native_distribution", {})
    if distribution.get("id") != data.get("distribution_id") or distribution.get("download_url") != [artifact["url"]]:
        raise ValueError("Manifest distribution and artifact identity disagree")
    return data, raw, hashlib.sha256(raw).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("EURIO download redirect rejected; refresh the manifest")


def digest_file(source):
    source.seek(0)
    digest = hashlib.sha256()
    for block in iter(lambda: source.read(1024 * 1024), b""):
        digest.update(block)
    source.seek(0)
    return digest.hexdigest()


def download(manifest_path, output, max_bytes=1024 * 1024 * 1024):
    manifest, _, manifest_hash = load_manifest(manifest_path)
    artifact = manifest["artifact"]
    if not 0 < artifact["bytes"] <= max_bytes:
        raise ValueError("Archive exceeds download byte limit")
    output = Path(output)
    if output.exists():
        raise FileExistsError("Refusing to overwrite an existing archive")
    request = urllib.request.Request(artifact["url"], headers={
        "If-Match": artifact["etag"], "Accept-Encoding": "identity",
        "User-Agent": "bio-mcp-eurio-bulk/1.0"})
    digest = hashlib.sha256()
    size = 0
    fd, temporary = tempfile.mkstemp(prefix=".eurio-download-", dir=output.parent)
    try:
        with os.fdopen(fd, "wb") as target:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
                if response.status != 200 or response.headers.get("ETag") != artifact["etag"]:
                    raise ValueError("Download status or ETag differs from the manifest")
                if response.headers.get("Content-Encoding", "identity") != "identity":
                    raise ValueError("Unexpected HTTP content encoding")
                if response.headers.get("Content-Length") != str(artifact["bytes"]):
                    raise ValueError("Download byte size differs from the manifest")
                for block in iter(lambda: response.read(1024 * 1024), b""):
                    size += len(block)
                    if size > artifact["bytes"]:
                        raise ValueError("Download exceeds pinned byte size")
                    digest.update(block)
                    target.write(block)
            if size != artifact["bytes"]:
                raise ValueError("Truncated EURIO download")
            target.flush()
            os.fsync(target.fileno())
        # Atomic, same-filesystem publication that never overwrites a concurrent file.
        os.link(temporary, output)
        return {"archive": str(output), "archive_sha256": digest.hexdigest(), "bytes": size,
                "manifest_sha256": manifest_hash, "source_url": artifact["url"], "etag": artifact["etag"],
                "checksum_source": "computed_from_complete_download", "provider_checksum_verified": False}
    finally:
        Path(temporary).unlink(missing_ok=True)
