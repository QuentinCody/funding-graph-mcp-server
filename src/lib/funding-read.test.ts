import { afterEach, describe, expect, it, vi } from "vitest";
import { createFundingGraphApiFetch } from "./api-adapter";
import { eurioQuery } from "./eurio-query";
import { readText } from "./response";
const api = createFundingGraphApiFetch();
const award = "CONT_AWD_H907_9700_SPE2DX16D1500_9700";
function mock(data: unknown, headers: Record<string, string> = {}) {
  return vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {headers: {"content-type": "application/json", ...headers}})));
}
const term = (value: string) => ({type: "literal", value});
const row = {project: {type: "uri", value: "https://example.org/project/123"}, project_id: term("123"), value: {type: "literal", value: "0.00", datatype: "http://www.w3.org/2001/XMLSchema#decimal"}, title: {...term("Titre"), "xml:lang": "fr"}};
const rdf = (bindings = [row]) => ({head: {vars: ["project", "project_id", "value", "title"]}, results: {bindings}});
const eurio = (params: Record<string, unknown> = {}) => api({method: "GET", path: "/eurio/project", params: {project_id: "123", ...params}});
afterEach(() => vi.unstubAllGlobals());
describe("USAspending bounded reads", () => {
  it("retains generated identity, recipient IDs and native monetary distinctions", async () => {
    const data = {id: 22834500, generated_unique_award_id: award, total_obligation: -12, total_outlays: 0, face_value_loan_guarantee: null, recipient: {uei: "ABC", duns: "00123"}};
    mock(data);
    const result = await api({method: "GET", path: `/usaspending/awards/${award}/`});
    expect(result.data).toMatchObject({...data, _funding: {requested_award_id: award, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}});
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`https://api.usaspending.gov/api/v2/awards/${award}/`);
  });
  it("accepts an internal ID only when the returned internal ID matches", async () => {
    mock({id: 123, generated_unique_award_id: award});
    expect((await api({method: "GET", path: "/usaspending/awards/123/"})).data).toMatchObject({id: 123});
  });
  it("rejects cross-award responses", async () => {
    mock({id: 123, generated_unique_award_id: "ASST_NON_OTHER"});
    await expect(api({method: "GET", path: `/usaspending/awards/${award}/`})).rejects.toThrow("different or unverified");
  });
  it.each(["FAIN123", "%ZZ", "0", "..", "CONT_AWD_x%2Fy"])("rejects invalid/ambiguous ID %s before fetch", async id => {
    mock({});
    await expect(api({method: "GET", path: `/usaspending/awards/${id}/`})).rejects.toMatchObject({status: 400});
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains transaction pagination and negative/zero/null values without summing", async () => {
    const data = {results: [{id: "ASST_TX_1", federal_action_obligation: -20, face_value_loan_guarantee: 0, original_loan_subsidy_cost: null}], page_metadata: {page: 2, next: 3, previous: 1, hasNext: true, hasPrevious: true}};
    mock(data);
    const result = await api({method: "POST", path: "/usaspending/transactions/", body: {award_id: award, page: 2, limit: 1}});
    expect(result.data).toMatchObject({...data, _funding: {coverage: "one_transaction_page"}});
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({award_id: award, page: 2, limit: 1, sort: "action_date", order: "desc"});
  });
  it.each([{limit: 101}, {page: 0}, {sort: "award_id"}, {order: "DESC"}, {unknown: true}])("rejects unsupported transaction options %j", async options => {
    mock({});
    await expect(api({method: "POST", path: "/usaspending/transactions/", body: {award_id: award, ...options}})).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{results: [], page_metadata: {page: 2, hasNext: false}}, {results: [], page_metadata: {page: 1}}, {results: [1, 2], page_metadata: {page: 1, hasNext: false}}])("rejects malformed pagination %j", async data => {
    mock(data);
    await expect(api({method: "POST", path: "/usaspending/transactions/", body: {award_id: award, limit: 1}})).rejects.toMatchObject({status: 502});
  });
  it("preserves an empty provider last_updated rather than inventing a release", async () => {
    mock({last_updated: ""});
    expect((await api({method: "GET", path: "/usaspending/awards/last_updated/"})).data).toMatchObject({last_updated: ""});
  });
  it("rejects missing update metadata", async () => {
    mock({});
    await expect(api({method: "GET", path: "/usaspending/awards/last_updated/"})).rejects.toThrow("last_updated");
  });
});
describe("EURIO RDF reads", () => {
  it("retains RDF URI, datatype and language with source hash and bounded continuation", async () => {
    mock(rdf());
    const result = await eurio({limit: 1});
    expect(result.data).toMatchObject({...rdf(), _eurio: {next_offset: 1, complete: false, snapshot_version: null, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}});
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://cordis.europa.eu/datalab/sparql");
    expect(url.searchParams.get("query")).toContain('FILTER(STR(?project_id) = "123")');
  });
  it.each<Record<string, string>>([{"X-SQL-State": "S1TAT"}, {"X-SPARQL-MaxRows": "1"}])("does not supply continuation for provider-partial responses %j", async headers => {
    mock(rdf(), headers);
    expect((await eurio({limit: 1})).data).toMatchObject({_eurio: {provider_partial: true, next_offset: null, complete: false}});
  });
  it("stops continuation at the local offset bound", async () => {
    mock(rdf());
    expect((await eurio({limit: 1, offset: 100000})).data).toMatchObject({_eurio: {next_offset: null, continuation_limit_reached: true}});
  });
  it("does not infer project absence or dataset completeness from an empty page", async () => {
    mock(rdf([]));
    expect((await eurio()).data).toMatchObject({_eurio: {returned_rows: 0, next_offset: null, complete: false}});
  });
  it.each([{head: {}, results: {bindings: []}}, rdf([{...row, project_id: term("999")}]), rdf([{...row, value: {type: "literal", value: 12} as never}])])("rejects malformed or cross-project RDF %j", async data => {
    mock(data);
    await expect(eurio()).rejects.toMatchObject({status: 502});
  });
  it.each([{limit: 101}, {offset: -1}, {project_id: ""}, {query: "DELETE WHERE {?s ?p ?o}"}])("rejects invalid request %j before network", async params => {
    mock(rdf());
    await expect(eurio(params)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("escapes an identifier as one SPARQL literal", () => {
    const id = '123" ) } UNION { ?a ?b ?c } #\\';
    expect(eurioQuery("/eurio/project", {project_id: id}).query).toContain(`FILTER(STR(?project_id) = ${JSON.stringify(id)})`);
  });
  it("keeps optional publication metadata optional", () => {
    const query = eurioQuery("/eurio/publications", {project_id: "123"}).query;
    expect(query).toContain("?publication a eurio:ProjectPublication");
    expect(query).toContain("OPTIONAL { ?publication eurio:doi ?doi }");
  });
});
describe("funding response safety", () => {
  it("redacts upstream error bodies which may reflect DET credentials", async () => {
    await expect(readText(new Response("key=fixture-secret", {status: 401}))).rejects.toThrow("Funding provider HTTP 401");
  });
  it("rejects oversized transport bodies", async () => {
    await expect(readText(new Response("x".repeat(4 * 1024 * 1024 + 1)))).rejects.toThrow("exceeds 4 MiB");
  });
  it("rejects HTML success envelopes", async () => {
    await expect(readText(new Response("<!doctype html><html>unavailable</html>"))).rejects.toThrow("HTML");
  });
  it("rejects a provider error inside HTTP 200", async () => {
    mock({detail: "bad request"});
    await expect(eurio()).rejects.toThrow("error envelope");
  });
  it.each([{method: "POST", path: "/eurio/project", params: {project_id: "123"}}, {method: "GET", path: "/usaspending/transactions/"}, {method: "GET", path: `/usaspending/awards/${award}/`, body: {}}, {method: "GET", path: `/usaspending/awards/${award}/`, params: {key: "irrelevant"}}])("rejects wrong request shape %j", async request => {
    mock({});
    await expect(api(request)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
