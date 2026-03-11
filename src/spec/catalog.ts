import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const fundingGraphCatalog: ApiCatalog = {
	name: "Funding Graph (NIH RePORTER + NSF Award Search + CORDIS DET + USAspending)",
	baseUrl: "https://multi-api.local/funding-graph",
	version: "0.1",
	auth: "mixed_public_and_api_key",
	endpointCount: 14,
	notes:
		"- Multi-API REST server. Prefix every path with /reporter, /nsf, /cordis, or /usaspending.\n" +
		"- NIH RePORTER and USAspending use POST search endpoints with JSON bodies.\n" +
		"- NSF Award Search uses .json suffix endpoints and query string filters.\n" +
		"- CORDIS DET is an extraction-job API and requires an API key in the query string.\n" +
		"- Preserve source-specific identifiers such as project_num, award_id, recipient_id, taskId, and agency codes in staged tables.",
	endpoints: [
		{
			method: "POST",
			path: "/reporter/projects/search",
			summary: "Search NIH RePORTER projects by criteria",
			category: "reporter.projects",
			body: { contentType: "application/json", description: "RePORTER search criteria payload" },
		},
		{
			method: "POST",
			path: "/reporter/publications/search",
			summary: "Search NIH RePORTER publications by project, PMIDs, or text criteria",
			category: "reporter.publications",
			body: { contentType: "application/json", description: "RePORTER publication search criteria payload" },
		},
		{
			method: "GET",
			path: "/nsf/awards.json",
			summary: "Search NSF awards",
			category: "nsf.awards",
			queryParams: [
				{ name: "keyword", type: "string", required: false, description: "Keyword query" },
				{ name: "offset", type: "number", required: false, description: "Result offset" },
				{ name: "printFields", type: "string", required: false, description: "Comma-separated field list" },
				{ name: "rpp", type: "number", required: false, description: "Results per page" },
			],
		},
		{
			method: "GET",
			path: "/nsf/awards/{award_id}.json",
			summary: "Get a specific NSF award",
			category: "nsf.awards",
			pathParams: [{ name: "award_id", type: "string", required: true, description: "NSF award ID" }],
		},
		{
			method: "GET",
			path: "/nsf/awards/{award_id}/projectoutcomes.json",
			summary: "Get NSF project outcomes report for an award",
			category: "nsf.outcomes",
			pathParams: [{ name: "award_id", type: "string", required: true, description: "NSF award ID" }],
		},
		{
			method: "GET",
			path: "/cordis/getExtraction",
			summary: "Create a CORDIS DET extraction job",
			category: "cordis.extractions",
			queryParams: [
				{ name: "query", type: "string", required: true, description: "CORDIS extraction query" },
				{ name: "key", type: "string", required: true, description: "CORDIS API key" },
				{ name: "outputFormat", type: "string", required: true, description: "xml, csv, json, xlsx, or summary" },
				{ name: "archived", type: "boolean", required: false, description: "Include archived content" },
			],
		},
		{
			method: "GET",
			path: "/cordis/getExtractionStatus",
			summary: "Get status for a CORDIS extraction job",
			category: "cordis.extractions",
			queryParams: [
				{ name: "key", type: "string", required: true, description: "CORDIS API key" },
				{ name: "taskId", type: "string", required: true, description: "CORDIS task ID" },
			],
		},
		{
			method: "GET",
			path: "/cordis/listExtractions",
			summary: "List CORDIS extraction jobs for the API key",
			category: "cordis.extractions",
			queryParams: [{ name: "key", type: "string", required: true, description: "CORDIS API key" }],
		},
		{
			method: "GET",
			path: "/cordis/cancelExtraction",
			summary: "Cancel an ongoing CORDIS extraction job",
			category: "cordis.extractions",
			queryParams: [
				{ name: "key", type: "string", required: true, description: "CORDIS API key" },
				{ name: "taskId", type: "string", required: true, description: "CORDIS task ID" },
			],
		},
		{
			method: "DELETE",
			path: "/cordis/deleteExtraction",
			summary: "Delete a CORDIS extraction job",
			category: "cordis.extractions",
			queryParams: [
				{ name: "key", type: "string", required: true, description: "CORDIS API key" },
				{ name: "taskId", type: "string", required: true, description: "CORDIS task ID" },
			],
		},
		{
			method: "POST",
			path: "/usaspending/search/spending_by_award/",
			summary: "Search USAspending awards",
			category: "usaspending.awards",
			body: { contentType: "application/json", description: "USAspending award search payload" },
		},
		{
			method: "POST",
			path: "/usaspending/search/spending_by_award_count/",
			summary: "Count USAspending awards for a filter set",
			category: "usaspending.awards",
			body: { contentType: "application/json", description: "USAspending award count payload" },
		},
		{
			method: "GET",
			path: "/usaspending/agency/{agency_code}/",
			summary: "Get USAspending agency summary by toptier code",
			category: "usaspending.agencies",
			pathParams: [{ name: "agency_code", type: "string", required: true, description: "Top-tier agency code" }],
		},
		{
			method: "POST",
			path: "/usaspending/autocomplete/recipient/",
			summary: "Autocomplete USAspending recipients",
			category: "usaspending.recipients",
			body: { contentType: "application/json", description: "Recipient autocomplete payload" },
		},
	],
};
