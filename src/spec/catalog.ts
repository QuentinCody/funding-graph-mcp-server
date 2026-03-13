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
		"- Preserve source-specific identifiers such as project_num, award_id, recipient_id, taskId, and agency codes in staged tables.\n" +
		"\n" +
		"NIH RePORTER /projects/search POST body format:\n" +
		"  { criteria: { ... }, offset: 0, limit: 25, sort_field: 'project_start_date', sort_order: 'desc' }\n" +
		"  criteria fields (all optional):\n" +
		"    advanced_text_search: { operator: 'and'|'or'|'advanced', search_field: 'terms'|'projecttitle'|'abstract'|'projectnumber', search_text: 'query string' }\n" +
		"    pi_names: [{ first_name: 'John', last_name: 'Doe' }]\n" +
		"    org_names: ['Massachusetts Institute of Technology']\n" +
		"    org_cities: ['Boston'], org_states: ['MA']\n" +
		"    fiscal_years: [2024, 2025]\n" +
		"    agencies: ['NIH']  (or specific ICs: ['NIMH','NCI','NIGMS'])\n" +
		"    project_nums: ['R01CA123456']\n" +
		"    award_types: ['1']  (1=new, 2=competing renewal, 5=non-competing)\n" +
		"    activity_codes: ['R01','R21','U01','P01']\n" +
		"  IMPORTANT: For text search, you MUST use criteria.advanced_text_search, NOT criteria.text_search or a top-level query field.\n" +
		"\n" +
		"NIH RePORTER /publications/search POST body format:\n" +
		"  { criteria: { pmids: [12345678] }, offset: 0, limit: 25 }\n" +
		"  OR { criteria: { core_project_nums: ['R01CA123456'] }, offset: 0, limit: 25 }",
	endpoints: [
		{
			method: "POST",
			path: "/reporter/projects/search",
			summary: "Search NIH RePORTER projects by criteria. Body: { criteria: { advanced_text_search: { operator, search_field, search_text }, pi_names, org_names, fiscal_years, agencies, activity_codes }, offset, limit, sort_field, sort_order }",
			category: "reporter.projects",
			body: {
				contentType: "application/json",
				description:
					"RePORTER project search. REQUIRED structure: { criteria: { advanced_text_search: { operator: 'and', search_field: 'terms', search_text: 'your query' } }, offset: 0, limit: 25 }. " +
					"Other criteria fields: pi_names (array of {first_name, last_name}), org_names (array of strings), fiscal_years (array of ints), agencies (array like ['NIH']), activity_codes (array like ['R01','R21']).",
			},
		},
		{
			method: "POST",
			path: "/reporter/publications/search",
			summary: "Search NIH RePORTER publications by project numbers or PMIDs",
			category: "reporter.publications",
			body: {
				contentType: "application/json",
				description:
					"RePORTER publication search. Body: { criteria: { pmids: [12345678] }, offset: 0, limit: 25 } " +
					"OR { criteria: { core_project_nums: ['R01CA123456'] }, offset: 0, limit: 25 }.",
			},
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
