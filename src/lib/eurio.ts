import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import type { Completeness } from "@bio-mcp/shared";
import { digest, fail, parseObject, readText } from "./response";
import { eurioQuery } from "./eurio-query";
export const EURIO_ENDPOINT = "https://cordis.europa.eu/datalab/sparql";
export async function eurioRead(request: Parameters<ApiFetchFn>[0]) {
  if (request.method.toUpperCase() !== "GET" || request.body !== undefined) fail("EURIO helpers require GET without a body", 405);
  const selection = eurioQuery(request.path, request.params ?? {});
  const url = new URL(EURIO_ENDPOINT);
  url.searchParams.set("query", selection.query);
  url.searchParams.set("format", "application/sparql-results+json");
  const response = await fetch(url, {headers: {Accept: "application/sparql-results+json"}, signal: AbortSignal.timeout(45_000), redirect: "manual"});
  const { completeness, data, raw, bindings, more, partial, offsetLimit, maxRows, sqlState }: { completeness: Completeness; data: Record<string, unknown>; raw: string; bindings: any[]; more: boolean; partial: boolean; offsetLimit: boolean; maxRows: string | null; sqlState: string | null; } = await readEurioBindings(response, selection);
  return {status: response.status, completeness, data: {...data, _eurio: {
    endpoint: EURIO_ENDPOINT, retrieved_at: new Date().toISOString(), response_sha256: await digest(raw),
    query: selection.query, project_id: selection.id, limit: selection.limit, offset: selection.offset,
    returned_rows: bindings.length, next_offset: more && !partial && !offsetLimit ? selection.offset + selection.limit : null,
    provider_partial: partial, continuation_limit_reached: more && offsetLimit,
    complete: false,
    coverage: "one_page_of_bindings", snapshot_version: null,
    limitation: "Rows are RDF bindings, not unique projects/organisations/publications. Optional multi-valued fields can produce multiple rows; preserve RDF identity, language and datatype. Live OFFSET pages are not an immutable snapshot.",
    provider_partial_headers: {max_rows: maxRows, sql_state: sqlState, sql_message: response.headers.get("X-SQL-Message")},
    dump_catalog: "https://data.europa.eu/data/datasets/named-graphs-from-eurio-knowledge-graph",
  }}};
}

async function readEurioBindings(response: Response, selection: { id: string; limit: number; offset: number; query: string; }) {
  const raw = await readText(response);
  const data = parseObject(raw);
  const head = data.head as Record<string, unknown> | undefined;
  const results = data.results as Record<string, unknown> | undefined;
  if (!head || !Array.isArray(head.vars) || !results || !Array.isArray(results.bindings)) fail("EURIO returned an invalid SPARQL results envelope", 502);
  if (head.vars.some(variable => typeof variable !== "string")) fail("Invalid SPARQL variable declaration", 502);
  const bindings = results.bindings;
  const sqlState = response.headers.get("X-SQL-State");
  const maxRows = response.headers.get("X-SPARQL-MaxRows");
  const partial = !!(sqlState && sqlState !== "00000") || maxRows !== null;
  const more = bindings.length === selection.limit;
  const offsetLimit = selection.offset + selection.limit > 100000;
  if (bindings.length > selection.limit) fail("EURIO exceeded requested row limit", 502);
  for (const row of bindings) {
    if (!row || typeof row !== "object" || row.project_id?.value !== selection.id) fail("EURIO returned an unverified project identifier", 502);
    for (const term of Object.values(row)) {
      if (!term || typeof term !== "object" || !("value" in term) || typeof term.value !== "string" || !("type" in term) || !["uri", "bnode", "literal", "typed-literal"].includes(String(term.type))) fail("Invalid RDF term in EURIO response", 502);
    }
  }
  const completeness: Completeness = {
    complete: false, returned: bindings.length, truncation: {
      reason: partial ? "upstream_cap" : "unknown",
      detail: "One EURIO binding page cannot establish complete project coverage or an immutable snapshot.",
      remedy: "Inspect _eurio provider_partial_headers and next_offset; paginate explicitly or use the official named-graph dumps.",
    }
  };
  return { completeness, data, raw, bindings, more, partial, offsetLimit, maxRows, sqlState };
}
