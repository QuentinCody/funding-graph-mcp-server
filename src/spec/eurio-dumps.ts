import type { ApiCatalog, WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";

export const dumpEndpoints: ApiCatalog["endpoints"] = [
  {method: "GET", path: "/eurio/dumps", category: "cordis.eurio.bulk",
    summary: "Discover the official EURIO dump catalogue with native distribution IDs, formats, download URLs, dates and licensing. Large catalogues stage; payloads retains the complete native envelope."},
  {method: "GET", path: "/eurio/dump-manifest", category: "cordis.eurio.bulk",
    summary: "Pin one current EURIO ZIP distribution with HEAD byte size and strong ETag. Retain native catalogue metadata separately from file dates. Downloads/imports run through the local eurio_bulk.py CLI; N-Quads import preserves named graphs and literal lexical values.",
    queryParams: [{name: "distribution_id", type: "string", required: true, description: "Exact distribution ID from /eurio/dumps, not a CORDIS project ID. Select an -nq.zip distribution for the local importer."}]},
];
export const dumpWorkflows: WorkflowRecipe[] = [{title: "Discover EURIO snapshots for local bulk analysis",
  keywords: ["EURIO", "bulk", "snapshot", "N-Quads", "download", "named graph"],
  description: "Read the native catalogue, choose an exact N-Quads distribution, then request /eurio/dump-manifest with distribution_id. Retain the full manifest and use the local CLI to download with If-Match, compute an archive SHA-256, and import verified quads into SQLite. No implicit cross-snapshot join or complete current-API coverage is claimed.",
  code: 'return await api.get("/eurio/dumps");'}];
