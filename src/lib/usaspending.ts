import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import type { Completeness } from "@bio-mcp/shared";
import { digest, fail, integer, only, parseObject, readText } from "./response";
export const USA_BASE = "https://api.usaspending.gov/api/v2";
const SORTS = ["modification_number", "action_date", "federal_action_obligation", "face_value_loan_guarantee", "original_loan_subsidy_cost", "action_type_description", "description"];
function awardId(value: unknown): string | number {
  if (typeof value === "number") return integer(value, "award_id", 1, Number.MAX_SAFE_INTEGER);
  if (typeof value !== "string" || value.length > 300 || !/^(?:[1-9][0-9]*|(?:CONT_AWD_|CONT_IDV_|ASST_)[A-Za-z0-9_.-]+)$/.test(value)) fail("Use the USAspending generated award identifier or internal numeric ID, not a bare FAIN/PIID");
  return value;
}
function input(request: Parameters<ApiFetchFn>[0]) {
  const match = request.path.match(/^\/usaspending\/awards\/([^/]+)\/?$/);
  const detail = !!match && match[1] !== "last_updated";
  const updated = /^\/usaspending\/awards\/last_updated\/?$/.test(request.path);
  const transactions = /^\/usaspending\/transactions\/?$/.test(request.path);
  if (!detail && !updated && !transactions) fail("Unsupported USAspending read operation", 404);
  if (request.method.toUpperCase() !== (transactions ? "POST" : "GET")) fail("Unsupported HTTP method", 405);
  if (Object.keys(request.params ?? {}).length) fail("These USAspending operations do not accept query parameters");
  if (!transactions && request.body !== undefined) fail("GET cannot have a body");
  let decoded: string | undefined;
  if (detail) {
    try { decoded = decodeURIComponent(match![1]); } catch { fail("Invalid encoded award identifier"); }
  }
  if (!transactions) return {detail, updated, id: detail ? awardId(decoded) : undefined, body: undefined};
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) fail("Expected transaction JSON body");
  const body = request.body as Record<string, unknown>;
  only(body, ["award_id", "page", "limit", "sort", "order"]);
  const id = awardId(body.award_id);
  const page = integer(body.page ?? 1, "page", 1, 1_000_000);
  const limit = integer(body.limit ?? 25, "limit", 1, 100);
  const sort = body.sort ?? "action_date";
  const order = body.order ?? "desc";
  if (!SORTS.includes(String(sort)) || !["asc", "desc"].includes(String(order))) fail("Invalid transaction sort/order");
  return {detail, updated, id, body: {award_id: id, page, limit, sort, order}};
}
export async function usaRead(request: Parameters<ApiFetchFn>[0]) {
  const selected = input(request);
  const path = selected.detail ? `/awards/${encodeURIComponent(String(selected.id))}/` : selected.updated ? "/awards/last_updated/" : "/transactions/";
  const response = await fetch(`${USA_BASE}${path}`, {
    method: selected.body ? "POST" : "GET", body: selected.body ? JSON.stringify(selected.body) : undefined,
    headers: {Accept: "application/json", "Content-Type": "application/json"}, signal: AbortSignal.timeout(45_000), redirect: "manual",
  });
  const raw = await readText(response);
  const data = parseObject(raw);
  if (selected.updated && typeof data.last_updated !== "string") fail("USAspending omitted last_updated", 502);
  if (selected.detail) {
    const matches = typeof selected.id === "number" || /^\d+$/.test(String(selected.id))
      ? String(data.id) === String(selected.id) : data.generated_unique_award_id === selected.id;
    if (!matches) fail("USAspending returned a different or unverified award identifier", 502);
  }
  if (selected.body) {
    if (!Array.isArray(data.results) || data.results.length > selected.body.limit) fail("Invalid or oversized transaction result page", 502);
    if (data.results.some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("Invalid transaction record", 502);
    const meta = data.page_metadata as Record<string, unknown> | undefined;
    if (!meta || meta.page !== selected.body.page || typeof meta.hasNext !== "boolean") fail("Transaction page_metadata does not match requested page", 502);
  }
  const completeness: Completeness | undefined = selected.body ? {
    complete: false, returned: (data.results as unknown[]).length,
    truncation: {reason: "unknown", detail: "One transaction page; complete award history is not asserted.", remedy: "Follow native page_metadata from page 1; verify the generated award identity before interpreting an empty page."},
  } : undefined;
  return {status: response.status, completeness, data: {...data, _funding: {
    source: "usaspending", source_url: `${USA_BASE}${path}`, retrieved_at: new Date().toISOString(), response_sha256: await digest(raw),
    requested_award_id: selected.id, request: selected.body,
    identifier_scope: "USAspending generated award identifier (preferred) or internal ID; FAIN, PIID, URI, parent award, recipient UEI/DUNS and agency IDs remain distinct.",
    amount_scope: "Preserve native amounts, nulls, signs and dates. Obligations, outlays, loan value/subsidy and contract ceilings are different measures; no aggregation is performed.",
    coverage: selected.body ? "one_transaction_page" : selected.updated ? "provider_update_metadata" : "award_detail",
    ...(completeness ? {completeness} : {}),
  }}};
}
