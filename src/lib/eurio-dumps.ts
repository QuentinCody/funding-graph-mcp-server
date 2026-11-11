import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { digest, fail, only, parseObject, readText } from "./response";

export const DUMP_CATALOGUE = "https://data.europa.eu/api/hub/search/datasets/named-graphs-from-eurio-knowledge-graph";
const DATASET = "named-graphs-from-eurio-knowledge-graph";
const USER_AGENT = "bio-mcp-funding-graph/1.0";
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Invalid EURIO catalogue object", 502);
  return value as Record<string, unknown>;
};

export function dumpUrl(value: unknown): string {
  if (typeof value !== "string" || !/^https:\/\/cordis\.europa\.eu\/data\/cordis-(?:projectNamedGraph|organisationNamedGraph|resultNamedGraph|EURIOKnowledgeGraph)-(?:nq|n3|ttl|rdf|jsonld)\.zip$/.test(value)) fail("Expected an official EURIO archive URL", 502);
  return value;
}

async function artifact(url: string) {
  const response = await fetch(url, {method: "HEAD", signal: AbortSignal.timeout(45_000), redirect: "manual", headers: {"Accept-Encoding": "identity", "User-Agent": USER_AGENT}});
  if (response.status !== 200) fail(`EURIO archive HEAD returned HTTP ${response.status}`, response.status >= 400 ? response.status : 502);
  if (response.headers.has("content-range")) fail("EURIO archive HEAD returned partial metadata", 502);
  const length = response.headers.get("content-length");
  const bytes = length && /^\d+$/.test(length) ? Number(length) : Number.NaN;
  const etag = response.headers.get("etag");
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || !etag || !/^"[^"\r\n]+"$/.test(etag)) fail("EURIO archive lacks a byte size or strong ETag; cannot pin download", 502);
  return {url, bytes, etag, last_modified: response.headers.get("last-modified"), content_type: response.headers.get("content-type"),
    sha256: null, checksum_scope: "No provider SHA-256 advertised; downloader must compute and retain one. ETag is an HTTP validator, not a checksum."};
}

export async function eurioDumps(request: Parameters<ApiFetchFn>[0]) {
  if (request.method.toUpperCase() !== "GET" || request.body !== undefined) fail("EURIO dump discovery requires GET without a body", 405);
  const manifest = request.path === "/eurio/dump-manifest";
  if (!manifest && request.path !== "/eurio/dumps") fail("Unknown EURIO dump operation", 404);
  const params = request.params ?? {};
  only(params, manifest ? ["distribution_id"] : []);
  if (manifest && (typeof params.distribution_id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(params.distribution_id))) fail("An exact catalogue distribution_id is required");
  const response = await fetch(DUMP_CATALOGUE, {headers: {Accept: "application/json", "User-Agent": USER_AGENT}, signal: AbortSignal.timeout(45_000), redirect: "manual"});
  const text = await readText(response);
  const native = parseObject(text);
  const catalogue = record(native.result);
  if (catalogue.id !== DATASET || !Array.isArray(catalogue.distributions)) fail("Unexpected EURIO dataset identity or distributions", 502);
  const provenance = {source_url: DUMP_CATALOGUE, retrieved_at: new Date().toISOString(), response_sha256: await digest(text),
    dataset_id: DATASET, issued: catalogue.issued ?? null, catalog_record: catalogue.catalog_record ?? null};
  if (!manifest) return {status: response.status, data: {...native, _eurio_dump: provenance}};
  const matches = catalogue.distributions.filter(item => record(item).id === params.distribution_id);
  if (matches.length !== 1) fail("EURIO distribution identity is absent or ambiguous", 404);
  const distribution = record(matches[0]);
  if (!Array.isArray(distribution.download_url) || distribution.download_url.length !== 1) fail("EURIO distribution needs one exact download URL", 502);
  const selected = await artifact(dumpUrl(distribution.download_url[0]));
  return {status: 200, data: {format_version: "eurio-dump-manifest-1", distribution_id: distribution.id, catalogue: provenance,
    native_distribution: distribution, artifact: selected, archive_downloaded: false,
    import: {format: selected.url.endsWith("-nq.zip") ? "nquads" : null,
      command: "python3 servers/funding-graph-mcp-server/scripts/eurio_bulk.py --help",
      scope: "Local archive acquisition and SQLite import. Preserve source ZIP, manifest and SHA-256; no hosted graph or immutable provider release is implied."}}};
}
