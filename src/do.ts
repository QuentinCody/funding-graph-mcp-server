/**
 * FundingGraphDataDO — Durable Object for staging large funding and award responses.
 *
 * Extends RestStagingDO with source-aware schema hints across NIH RePORTER,
 * NSF Award Search, CORDIS DET, and USAspending.
 */

import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class FundingGraphDataDO extends RestStagingDO {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/process") return super.fetch(request);
    const body = await request.clone().json() as {data?: {head?: {vars?: unknown}; results?: {bindings?: unknown}}};
    const rows = body.data?.results?.bindings;
    if (!Array.isArray(body.data?.head?.vars) || !Array.isArray(rows) || rows.length === 0) return super.fetch(request);
    // Keep the exact RDF envelope before projecting binding rows into SQL.
    const retained = await super.fetch(request);
    if (!retained.ok) return retained;
    return super.fetch(new Request("https://do/process", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({...body, data: {eurio_bindings: rows}})}));
  }

	protected getSchemaHints(data: unknown): SchemaHints | undefined {
		if (!data || typeof data !== "object") return undefined;

		const obj = data as Record<string, unknown>;

        const rows = Array.isArray(data) ? data : Array.isArray(obj.results) ? obj.results : [];
        const first = rows[0];
        if (first && typeof first === "object" && "coreproject" in first && "pmid" in first) {
            return {tableName: "nih_publications", indexes: ["coreproject", "pmid", "applid"].filter(key => key in first)};
        }

		// NIH RePORTER / USAspending wrapper — { results: [...] }
		if (Array.isArray(obj.results)) {
			const sample = obj.results[0];
			if (sample && typeof sample === "object") {
				return {
					tableName: "results",
					indexes: ["project_num", "award_id", "recipient_id", "awardeeName"].filter(key => key in sample),
				};
			}
		}

		// NSF award wrapper — { response: { award: [...] } }
		const response = obj.response as Record<string, unknown> | undefined;
		if (response && Array.isArray(response.award)) {
			return {
				tableName: "nsf_awards",
				indexes: ["id", "awardeeName", "agency"],
			};
		}

		// CORDIS extraction wrapper — { status, payload }
		const payload = obj.payload as Record<string, unknown> | undefined;
		if (payload && typeof payload === "object") {
			return {
				tableName: "cordis_payload",
				indexes: ["taskId", "status", "query"],
			};
		}

		if (Array.isArray(data)) {
			const sample = data[0];
			if (sample && typeof sample === "object") {
				return {
					tableName: "records",
					indexes: ["id", "project_num", "award_id", "name"],
				};
			}
		}

		return undefined;
	}
}
