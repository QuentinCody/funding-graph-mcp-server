import type { WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";
export const fundingPublicationWorkflows: WorkflowRecipe[] = [
  { title: "NIH award publications with Europe PMC follow-up", keywords: ["NIH", "grant", "publication", "Europe PMC", "organization"],
    description: "Use an explicitly resolved NIH core project number, not a bare award ID from an unrelated funder. Returns bounded RePORTER pages and a read request for europepmc_execute; run that next on the Europe PMC server. Source-qualified PMIDs join publication records; author affiliations and award organizations remain distinct evidence. No automatic funder alias or award-number normalization.",
    code: `const coreProjectNumber = "R01CA183929"; // example verified in RePORTER; replace with the resolved NIH core number
const projects = await api.post("/reporter/projects/search", {criteria: {project_nums: [coreProjectNumber]}, offset: 0, limit: 25});
if (projects.__api_error || projects.__stage_error) return projects;
const publications = await api.post("/reporter/publications/search", {criteria: {core_project_nums: [coreProjectNumber]}, offset: 0, limit: 25, sort_field: "pmid", sort_order: "asc"});
if (publications.__api_error || publications.__stage_error) return {coreProjectNumber, projects, publications};
const publicationRows = publications.__staged
  ? (await api.query(publications.data_access_id, "SELECT coreproject, pmid FROM nih_publications ORDER BY pmid LIMIT 25")).results
  : publications.results;
if (!Array.isArray(publicationRows)) throw new Error("RePORTER response omitted publication rows");
const pmids = [...new Set(publicationRows.filter(row => row.coreproject === coreProjectNumber).map(row => String(row.pmid || "")).filter(id => /^[1-9][0-9]*$/.test(id)))].slice(0, 25);
return {coreProjectNumber, projects, publications, complete: false, europepmc_next: pmids.length ? {server: "europepmc", method: "GET", path: "/search", params: {query: "SRC:MED AND (" + pmids.map(id => "EXT_ID:" + id).join(" OR ") + ")", resultType: "core", pageSize: 25, cursorMark: "*"}} : null};` },
];
