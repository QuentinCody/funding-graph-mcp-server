import { fail, integer, only } from "./response";
export function eurioQuery(path: string, params: Record<string, unknown>) {
  only(params, ["project_id", "limit", "offset"]);
  const id = params.project_id;
  if (typeof id !== "string" || !id.trim() || id.length > 100 || Array.from(id).some(char => char.charCodeAt(0) < 32)) fail("project_id must be a nonempty identifier string (max 100 characters)");
  const limit = integer(params.limit ?? 25, "limit", 1, 100);
  const offset = integer(params.offset ?? 0, "offset", 0, 100_000);
  let variables: string;
  let patterns: string;
  if (path === "/eurio/project") {
    variables = "?project ?project_id ?predicate ?value";
    patterns = "?project ?predicate ?value .";
  } else if (path === "/eurio/participants") {
    variables = "?project ?project_id ?role ?role_label ?organisation ?organisation_name";
    patterns = `?project eurio:hasInvolvedParty ?role .
?role eurio:isRoleOf ?organisation .
OPTIONAL { ?role eurio:roleLabel ?role_label }
OPTIONAL { ?organisation eurio:legalName ?organisation_name }`;
  } else if (path === "/eurio/publications") {
    variables = "?project ?project_id ?publication ?title ?doi ?authors ?publisher";
    patterns = `?project eurio:hasResult ?publication .
?publication a eurio:ProjectPublication .
OPTIONAL { ?publication eurio:title ?title }
OPTIONAL { ?publication eurio:doi ?doi }
OPTIONAL { ?publication eurio:author ?authors }
OPTIONAL { ?publication eurio:publisher ?publisher }`;
  } else fail("Unknown EURIO operation", 404);
  // JSON string escaping is compatible with SPARQL short string literals.
  const query = `PREFIX eurio: <http://data.europa.eu/s66#>
SELECT DISTINCT ${variables} WHERE {
?project a eurio:Project ; eurio:identifier ?project_id .
FILTER(STR(?project_id) = ${JSON.stringify(id)})
${patterns}
}
ORDER BY ${variables}
LIMIT ${limit} OFFSET ${offset}`;
  return {id, limit, offset, query};
}
