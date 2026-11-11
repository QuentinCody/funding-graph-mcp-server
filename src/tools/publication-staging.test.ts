/// <reference types="node" />
import { afterEach, expect, it, vi } from "vitest";
import { hashCanonicalJson, verifyCitationEnvelope } from "@bio-mcp/shared";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
import { fixture, recover } from "./publication.test-support";

import { fundingPublicationWorkflows } from "../spec/publication-workflows";
import { fundingReadWorkflows } from "../spec/linked-data";

it("recovers large native dump catalogues and manifests through both aliases", async () => {
  const f = fixture();
  const id = "ccd8fbad-6a0b-4061-8321-24c4c6aaf329";
  const distribution = {id, download_url: ["https://cordis.europa.eu/data/cordis-organisationNamedGraph-nq.zip"], description: {el: "λ".repeat(80000)}};
  const native = {result: {id: "named-graphs-from-eurio-knowledge-graph", distributions: [distribution], catalog_record: {modified: "2026-09-29"}}};
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "HEAD"
    ? new Response(null, {headers: {"content-length": "1000", etag: '"fixture"'}}) : Response.json(native)));
  try {
    for (const prefix of ["", "mcp_"]) {
      for (const [path, params] of [["/eurio/dumps", {}], ["/eurio/dump-manifest", {distribution_id: id}]] as const) {
        const result = await f.tools[`${prefix}funding_graph_execute`].handler({code: `return await api.get('${path}',${JSON.stringify(params)});`}, {});
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30720);
        expect(result.structuredContent.data).toMatchObject({__staged: true});
        expect(result.structuredContent._staging).toEqual(expect.any(Object));
        const recovered = await recover(f, result.structuredContent.data.data_access_id, prefix);
        if (path === "/eurio/dumps") expect(recovered).toMatchObject(native);
        else expect(recovered).toMatchObject({native_distribution: distribution, artifact: {bytes: 1000, etag: '"fixture"', sha256: null}, archive_downloaded: false});
      }
    }
  } finally { f.close(); }
});

it("recovers staged RDF terms and binding rows without labeling a provider page complete", async () => {
  const f = fixture();
  const bindings = Array.from({length: 100}, (_,i) => ({
    project: {type: "uri", value: "http://data.europa.eu/s66/resource/projects/fixture"},
    project_id: {type: "literal", value: "101017453"},
    publication: {type: "uri", value: `http://data.europa.eu/s66/resource/results/${i}`},
    title: {type: "literal", "xml:lang": "el", value: "λ".repeat(200)},
    doi: {type: "typed-literal", datatype: "http://www.w3.org/2001/XMLSchema#anyURI", value: `10.1000/${i}`},
  }));
  const native = {head: {vars: ["project", "project_id", "publication", "title", "doi"]}, results: {bindings}};
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try {
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}funding_graph_execute`].handler({code: "return await api.get('/eurio/publications',{project_id:'101017453',limit:100});"}, {});
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const data = result.structuredContent.data;
      expect(data).toMatchObject({__staged: true});
      expect(result.structuredContent._meta.completeness).toMatchObject({complete: false, returned: 100});
      const recovered = await recover(f, data.data_access_id, prefix);
      expect(recovered).toMatchObject(native);
      const query = await f.tools[`${prefix}funding_graph_query_data`].handler({data_access_id: data.data_access_id,
        sql: 'SELECT count(*) AS n, min(title_type) AS kind, min("title_xml:lang") AS language, min(doi_datatype) AS datatype FROM eurio_bindings'}, {});
      expect(query.isError, JSON.stringify(query)).not.toBe(true);
      expect(query.structuredContent.data.rows).toEqual([{n: 100, kind: "literal", language: "el", datatype: "http://www.w3.org/2001/XMLSchema#anyURI"}]);
    }
  } finally { f.close(); }
});

it("continues a staged award into a staged transaction page and retains both sources", async () => {
  const f = fixture();
  const award = "CONT_AWD_H907_9700_SPE2DX16D1500_9700";
  const detail = {id: 12, generated_unique_award_id: award, description: "λ".repeat(20000)};
  const transactions = {page_metadata: {page: 1, hasNext: true, next: 2}, results: Array.from({length: 25}, (_,i) => ({id: `CONT_TX_${i}`, description: "λ".repeat(1000), federal_action_obligation: -(i+1)}))};
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes('/transactions/') ? transactions : detail)));
  try {
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}funding_graph_execute`].handler({code: fundingReadWorkflows[0].code}, {});
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const full = result.structuredContent.staged ? await recover(f, result.structuredContent.data_access_id, prefix) : result;
      const data = full.structuredContent.data;
      expect(data).toMatchObject({detail: {__staged: true}, transactions: {__staged: true}, complete: false});
      expect(data.transactions._staging.completeness.complete).toBe(false);
      expect(await recover(f, data.detail.data_access_id, prefix)).toMatchObject(detail);
      expect(await recover(f, data.transactions.data_access_id, prefix)).toMatchObject(transactions);
    }
  } finally { f.close(); }
});
it("continues staged NIH project and publication pages into a source-qualified Europe PMC handoff", async () => {
  const f = fixture();
  const projects = {meta: {total: 30}, results: Array.from({length: 25}, (_,i) => ({appl_id: i, core_project_num: "R01CA183929", project_num: `5R01CA183929-${i}`, organization: {org_name: "Award recipient"}, abstract: "λ".repeat(2000)}))};
  const publications = {meta: {total: 30}, results: Array.from({length: 25}, (_,i) => ({coreproject: "R01CA183929", pmid: i+1, applid: i, extra: "λ".repeat(2000)}))};
  vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json(url.includes("/publications/") ? publications : projects)));
  try {
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}funding_graph_execute`].handler({code: fundingPublicationWorkflows[0].code}, {});
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const data = result.structuredContent.data;
      expect(data).toMatchObject({complete: false, projects: {__staged: true}, publications: {__staged: true}, europepmc_next: {server: "europepmc", params: {resultType: "core"}}});
      expect(data.europepmc_next.params.query).toBe("SRC:MED AND ("+Array.from({length:25},(_,i)=>`EXT_ID:${i+1}`).join(" OR ")+")");
      expect(await recover(f, data.projects.data_access_id, prefix)).toEqual(projects);
      expect(await recover(f, data.publications.data_access_id, prefix)).toEqual(publications);
      expect(result.structuredContent._meta.citation.result_hash).toBe(await hashCanonicalJson(data));
    }
  } finally { f.close(); }
});

const bytes = (data: unknown) => new TextEncoder().encode(JSON.stringify(data)).byteLength;
it("verifies failed SQL citations against caller arguments when the limit is omitted", async () => {
  const f = fixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      const args = {data_access_id: "funding_graph_fixture", sql: "DELETE FROM payloads"};
      const tool = f.tools[`${prefix}funding_graph_query_data`];
      const parsed = tool.inputSchema.parse(args);
      const result = await tool.handler(parsed, {});
      expect(result.isError).toBe(true);
      const checked = await verifyCitationEnvelope({citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: args});
      expect(checked.verification).toMatchObject({query: "verified", result: "verified"});
    }
  } finally { f.close(); }
});
it("stages composed and SQL envelopes with verifiable citations and both error fields", async () => {
  const f = fixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      const args = {code: "return {text: 'α'.repeat(20000)};"};
      const result = await f.tools[`${prefix}funding_graph_execute`].handler(args, {});
      expect(bytes(result)).toBeLessThan(30720); expect(result.structuredContent._staging).toBeDefined();
      const id = result.structuredContent.data_access_id;
      const full = await recover(f, id, prefix); expect(full.structuredContent.data.text).toBe("α".repeat(20000));
      const verified = await verifyCitationEnvelope({citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: args, materialized: {value: full}});
      expect(verified.verification).toMatchObject({query: "verified", result: "verified", quarantined: false});
      const sql = {data_access_id: id, sql: "SELECT replace(hex(zeroblob(40000)), '00', 'x') AS value"};
      const query = await f.tools[`${prefix}funding_graph_query_data`].handler(sql, {});
      expect(query.structuredContent._staging).toBeDefined(); expect(bytes(query)).toBeLessThan(30720);
      const stored = await recover(f, query.structuredContent.data_access_id, prefix);
      expect(stored.structuredContent.data.rows[0].value).toBe("x".repeat(40000));
      const failed = await f.tools[`${prefix}funding_graph_query_data`].handler({data_access_id: id, sql: "DELETE FROM payloads"}, {});
      expect(failed).toMatchObject({isError: true, content: expect.any(Array), structuredContent: {success: false}});
    }
  } finally { f.close(); }
});
