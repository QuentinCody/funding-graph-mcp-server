import type { ApiCatalog, WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";
export const fundingReadEndpoints: ApiCatalog["endpoints"] = [
  {method: "GET", path: "/usaspending/awards/{award_id}/", category: "usaspending.awards",
    summary: "Read award detail using generated_internal_id from award search (returned as generated_unique_award_id in detail), or an internal numeric ID. Preserve recipient, parent-award, agency, obligation/outlay and loan fields separately.",
    pathParams: [{name: "award_id", type: "string", required: true, description: "Generated USAspending award ID, preferred; not bare FAIN/PIID or a recipient ID"}]},
  {method: "GET", path: "/usaspending/awards/last_updated/", category: "usaspending.awards",
    summary: "Award dataset update metadata. last_updated is a provider string, possibly empty; not an immutable release identifier."},
  {method: "POST", path: "/usaspending/transactions/", category: "usaspending.transactions",
    summary: "One bounded award transaction page; retain page_metadata, native amounts/signs/nulls and action dates. No aggregation.",
    body: {contentType: "application/json", description: "{award_id: generated ID or internal number, page: 1, limit: 25, sort: 'action_date', order: 'desc'}. Adapter limit 1–100. Sort: modification_number, action_date, federal_action_obligation, face_value_loan_guarantee, original_loan_subsidy_cost, action_type_description, description. Order asc/desc."}},
  ...["project", "participants", "publications"].map(resource => ({method: "GET" as const,
    path: `/eurio/${resource}`, category: "cordis.eurio",
    summary: `Public EURIO ${resource} RDF bindings for an exact CORDIS project identifier. Read-only SPARQL helper; no DET key. Preserve URI, language/datatype and optional missing values; rows are not unique entities.`,
    queryParams: [
      {name: "project_id", type: "string" as const, required: true, description: "Exact EURIO project identifier (max 100 characters)"},
      {name: "limit", type: "number" as const, required: false, description: "Binding rows, 1–100; default 25"},
      {name: "offset", type: "number" as const, required: false, description: "0–100000; default 0. Live OFFSET pages are not a pinned snapshot"},
    ]})),
];
export const fundingReadWorkflows: WorkflowRecipe[] = [
  {title: "USAspending award detail and transaction context", keywords: ["USAspending", "award", "transactions", "obligations", "recipient"],
    description: "Replace the example with a generated_internal_id resolved from award search. Retain full detail and one transaction page, including native identifiers and monetary measures; no complete-history or summed-spending claim.",
    code: `const awardId = "CONT_AWD_H907_9700_SPE2DX16D1500_9700";
const detail = await api.get("/usaspending/awards/" + encodeURIComponent(awardId) + "/");
if (detail.__api_error || detail.__stage_error) return detail;
const transactions = await api.post("/usaspending/transactions/", {award_id: awardId, page: 1, limit: 25, sort: "action_date", order: "desc"});
return {awardId, detail, transactions, complete: false};`},
  {title: "CORDIS project organisations and publications via EURIO", keywords: ["CORDIS", "EURIO", "SPARQL", "organization", "publication", "grant"],
    description: "Replace projectId with an explicitly resolved CORDIS project identifier. Read three bounded pages; keep RDF terms and relation roles. DOI/organisation strings are candidates for downstream joins, not confirmed identity matches. Full graphs can be acquired separately from the official EURIO dump catalog.",
    code: `const projectId = "101017453";
const project = await api.get("/eurio/project", {project_id: projectId, limit: 25, offset: 0});
if (project.__api_error || project.__stage_error) return project;
const participants = await api.get("/eurio/participants", {project_id: projectId, limit: 25, offset: 0});
if (participants.__api_error || participants.__stage_error) return {projectId, project, participants, complete: false};
const publications = await api.get("/eurio/publications", {project_id: projectId, limit: 25, offset: 0});
return {projectId, project, participants, publications, complete: false};`},
];
