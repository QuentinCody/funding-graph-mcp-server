/**
 * FundingGraphDataDO — Durable Object for staging large funding and award responses.
 *
 * Extends RestStagingDO with source-aware schema hints across NIH RePORTER,
 * NSF Award Search, CORDIS DET, and USAspending.
 */

import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class FundingGraphDataDO extends RestStagingDO {
	protected getSchemaHints(data: unknown): SchemaHints | undefined {
		if (!data || typeof data !== "object") return undefined;

		const obj = data as Record<string, unknown>;

		// NIH RePORTER / USAspending wrapper — { results: [...] }
		if (Array.isArray(obj.results)) {
			const sample = obj.results[0];
			if (sample && typeof sample === "object") {
				return {
					tableName: "results",
					indexes: ["project_num", "award_id", "recipient_id", "awardeeName"],
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
