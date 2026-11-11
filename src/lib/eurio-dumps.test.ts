import { afterEach, expect, it, vi } from "vitest";
import { fundingGraphCatalog } from "../spec/catalog";
import { createFundingGraphApiFetch } from "./api-adapter";
import { DUMP_CATALOGUE } from "./eurio-dumps";
import { digest } from "./response";
const api = createFundingGraphApiFetch();
const id = "ccd8fbad-6a0b-4061-8321-24c4c6aaf329";
const url = "https://cordis.europa.eu/data/cordis-organisationNamedGraph-nq.zip";
const distribution = {id, download_url: [url], title: {en: "Organisations", el: "Οργανισμοί"}, licence: {id: "CC_BY_4_0"}, modified: "2026-09-29"};
const native = {result: {id: "named-graphs-from-eurio-knowledge-graph", issued: "2026-01-02", catalog_record: {modified: "2026-09-29"}, distributions: [distribution]}, extra: "retained"};
const request = {method: "GET", path: "/eurio/dump-manifest", params: {distribution_id: id}};
function mock(catalogue: unknown = native, headers: Record<string, string> = {"content-length": "1000", etag: '"abc"', "last-modified": "Tue, 22 Sep 2026 11:43:34 GMT"}, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "HEAD" ? new Response(null, {headers, status}) : Response.json(catalogue)));
}
afterEach(() => vi.unstubAllGlobals());
it("preserves the full native catalogue with its own source digest", async () => {
  mock();
  expect((await api({method: "GET", path: "/eurio/dumps"})).data).toEqual({...native, _eurio_dump: {
    source_url: DUMP_CATALOGUE, retrieved_at: expect.any(String), response_sha256: await digest(JSON.stringify(native)),
    dataset_id: native.result.id, issued: native.result.issued, catalog_record: native.result.catalog_record,
  }});
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({redirect: "manual", headers: {"User-Agent": "bio-mcp-funding-graph/1.0"}});
});
it("pins HEAD metadata without downloading ZIP bytes or equating the ETag with a checksum", async () => {
  mock();
  expect((await api(request)).data).toMatchObject({distribution_id: id, native_distribution: distribution, archive_downloaded: false,
    artifact: {url, bytes: 1000, etag: '"abc"', sha256: null, last_modified: "Tue, 22 Sep 2026 11:43:34 GMT"}, import: {format: "nquads"}});
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls[1]).toEqual([url, expect.objectContaining({method: "HEAD", redirect: "manual", headers: {"Accept-Encoding": "identity", "User-Agent": "bio-mcp-funding-graph/1.0"}})]);
});
it.each([
  {method: "POST", path: "/eurio/dumps"}, {method: "GET", path: "/eurio/dumps", body: {}},
  {method: "GET", path: "/eurio/dumps", params: {url}}, {...request, params: {}},
  {...request, params: {distribution_id: "-".repeat(36)}}, {...request, params: {distribution_id: id, offset: 1}},
])("rejects unsupported input before network: %j", async input => {
  mock(); await expect(api(input)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it.each([
  {result: {...native.result, id: "another-dataset"}},
  {result: {...native.result, distributions: []}},
  {result: {...native.result, distributions: [distribution, distribution]}},
  {result: {...native.result, distributions: [{...distribution, download_url: [url, url]}]}},
  {result: {...native.result, distributions: [{...distribution, download_url: ["https://example.org/archive.zip"]}]}},
])("rejects catalogue identity or URL drift without acquiring the artifact", async catalogue => {
  mock(catalogue); await expect(api(request)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
});
it.each<Record<string, string>>([
  {"content-length": "1000", etag: 'W/"abc"'}, {"content-length": "0", etag: '"abc"'},
  {"content-length": "9007199254740992", etag: '"abc"'}, {"content-length": "1.5", etag: '"abc"'},
  {"content-length": "1000", etag: "abc"}, {etag: '"abc"'},
])("rejects an archive without reliable HTTP validators: %j", async headers => {
  mock(native, headers); await expect(api(request)).rejects.toMatchObject({status: 502});
});
it("refuses redirects rather than allowing a catalogue URL to select another host", async () => {
  mock(native, {location: "https://example.org"}, 302); await expect(api(request)).rejects.toMatchObject({status: 502});
});
it("advertises both bulk routes and an accurate endpoint count", () => {
  expect(fundingGraphCatalog.endpointCount).toBe(fundingGraphCatalog.endpoints.length);
  expect(fundingGraphCatalog.endpoints.filter(endpoint => endpoint.category === "cordis.eurio.bulk").map(endpoint => endpoint.path)).toEqual(["/eurio/dumps", "/eurio/dump-manifest"]);
});
