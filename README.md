# Funding Graph MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream Funding Graph API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

The server is deployed and ready at:

```
https://funding-graph-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "funding-graph": {
      "command": "npx",
      "args": ["mcp-remote", "https://funding-graph-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8820/mcp` (start it with `./scripts/dev-servers.sh funding-graph`):

```json
{
  "mcpServers": {
    "funding-graph-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8820/mcp"]
    }
  }
}
```

## Tools

- `funding_graph_search` — discover available API operations through the Code Mode catalog
- `funding_graph_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `funding_graph_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `funding_graph_get_schema` — inspect the inferred schema of a staged dataset

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

Provider bodies reject HTTP 206, Content-Range, invalid or inconsistent decoded
Content-Length, invalid UTF-8 and more than 4 MiB. Body reading has a 30-second
deadline after headers, in addition to existing fetch budgets. Cancellation does
not wait for acknowledgement. Leading BOM bytes and line endings remain part of
raw text and existing source hashes; JSON parsing removes only the leading BOM.
Errors do not echo DET credentials. Complete transport does not mean complete
search coverage or a completed extraction job. EURIO archive HEAD metadata must
also be free of Content-Range. [Transport review](../../docs/audits/2026-10-05-funding-transport-review.md).
The complete-response staging check reserves 1,024 bytes for MCP SDK
serialization. Actual HTTP boundary checks verify both aliases with ASCII and
Unicode payloads; near-limit results recover completely with verified citations.
[Boundary review](../../docs/audits/2026-10-05-funding-boundary-review.md).

## Development

```bash
./scripts/dev-servers.sh funding-graph            # run locally (port 8820)
pnpm --filter funding-graph-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*

## Europe PMC publication follow-up

The catalog workflow **NIH award publications with Europe PMC follow-up** retrieves bounded RePORTER project/organization and publication pages for an explicitly resolved NIH core project number. It preserves both source envelopes and returns an `europepmc_next` request for the Europe PMC server, selecting core article metadata by matching PMID with `SRC:MED`. Run that request through `europepmc_execute`; cross-server requests are not executed inside this server's `api` object.

The workflow reports partial coverage and retains staged/error handles. Only publication rows whose native `coreproject` matches the requested core number contribute PMIDs. Keep funder namespaces, full/core award numbers and organization identifiers distinct; an author affiliation is not automatically the award recipient. Europe PMC's `/grants/search` and `/grants/publications` complement these records, with same-record funder–grant evidence checks.

All four tools have both `funding_graph_*` and `mcp_funding_graph_*` aliases, with complete-response 30 KiB staging and verifiable citations. October 3 live acceptance passes 124 calls through both servers: the example `R01CA183929` returns 10 project records, a 25-of-29 publication page and 23 Europe PMC MED matches for 25 requested PMIDs. Publication requests sort by PMID; staged pages use the `nih_publications` SQL table. The workflow preserves the staged project envelope and proceeds to publications instead of stopping. Missing Europe PMC matches stay unresolved. Large composed and SQL responses recover through both aliases. This accepts the NIH handoff, not the USAspending/EURIO additions below. [NIH source contract](https://api.reporter.nih.gov/), [Europe PMC grant guidance](https://europepmc.org/help).

## USAspending award context and CORDIS linked data

The catalog adds `/usaspending/awards/{award_id}/`, `/usaspending/transactions/` and `/usaspending/awards/last_updated/`. Use the `generated_internal_id` from award search (returned as `generated_unique_award_id` in detail), or a numeric internal ID. A bare FAIN/PIID, recipient ID or parent award is not interchangeable with this identifier. Transaction pages are bounded to 100 rows and retain provider pagination. Native obligations, outlays, loan values/subsidies, signs, zeroes, nulls and dates remain separate; the adapter performs no financial aggregation. `last_updated` is provider metadata, not an immutable snapshot. See the [official award contract](https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/awards/award_id.md) and [transaction contract](https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/transactions.md).

`/eurio/project`, `/eurio/participants` and `/eurio/publications` perform fixed, read-only SPARQL queries against the public CORDIS EURIO endpoint. Supply an exact `project_id`, `limit` (1–100, default 25) and `offset` (0–100000). RDF terms preserve URI, language and datatype. Optional multi-valued publication fields can yield multiple bindings for one publication; do not treat row counts as entity counts. `_eurio` records the query, retrieval time, response hash, bounded continuation and provider partial-result headers. Partial responses suppress continuation; no page claims complete project coverage or an immutable dataset version. Bulk discovery and local import are described below. Ontology relations follow the [CORDIS SPARQL guide](https://cordis.europa.eu/about/sparql/en).

The two discovery recipes retain award/transaction context and project/organisation/publication bindings, including staged or error handles. Valid staged pages continue to the remaining reads. Large RDF responses expose an `eurio_bindings` SQL table while `payloads` retains the full original envelope. Flattened RDF columns preserve term types, datatypes and language (quote names such as `"title_xml:lang"` in SQL). Binding counts do not count distinct entities. Adapter coverage evidence survives staging; successfully storing a page does not certify complete upstream coverage. USAspending and EURIO reads have 45-second timeouts and a 4 MiB response bound. The existing CORDIS DET extraction API still requires its own key; it is separate from public EURIO reads. Extraction requests are not automatically retried, and error bodies are not echoed because they may reflect query credentials.

October 3 acceptance passes **228 MCP calls**, including SQL recovery, through both aliases against native USAspending/EURIO responses. Coverage includes contract and assistance award detail, numeric IDs, empty and continuing transaction pages, update metadata, RDF project/participant/publication pages, continuation, both recipes and errors. A further **14 calls** verify USAspending search-to-detail identity, existing NSF search/outcomes and catalog discovery. Search resolves `NNX17AJ96A` to `ASST_NON_NNX17AJ96A_080`; the old `_8000` example resolves to a different detail ID and is deliberately rejected. An empty transaction page for an outdated ID cannot establish absence. Fifty server tests and 41 focused shared tests pass.

Local acceptance uses the repository's installed Miniflare 4.20260424.0 with installed Node public CA roots added to the default trust store, retaining TLS verification. The server's older local Workerd fails USAspending TLS trust and also crashed during repeated reads; this is not a production runtime or trust-store change. No deployment or extraction job was performed.

## EURIO dump acquisition and local SQLite import

`GET /eurio/dumps` returns the complete [official EURIO catalogue](https://data.europa.eu/data/datasets/named-graphs-from-eurio-knowledge-graph), including native distribution IDs, URLs, formats, translated descriptions and licensing. Recover staged results from `payloads` (and `content_chunks` if the root contains a chunk marker). Select a distribution with an `-nq.zip` download URL, then call `GET /eurio/dump-manifest` with that exact `distribution_id`. Save the recovered manifest object as `manifest.json`; do not save the MCP envelope or a staging handle in its place.

The manifest retains the native distribution, catalogue retrieval time/hash and catalogue dates separately from archive HEAD metadata. It pins the current official URL, compressed byte count and strong ETag without downloading the archive. The catalogue requires an explicit User-Agent. Provider URLs are mutable, and an ETag is not a cryptographic checksum. Refresh discovery if the later download fails its `If-Match` or size/ETag checks.

The local CLI requires Python 3.10+ and the exact `rdflib==7.6.0` dependency in `scripts/requirements.txt`. It needs no service or database provisioning. From the repository root:

```bash
python3 -m pip install -r servers/funding-graph-mcp-server/scripts/requirements.txt
python3 servers/funding-graph-mcp-server/scripts/eurio_bulk.py download \
  --manifest manifest.json --output organisations.zip > download-receipt.json
python3 servers/funding-graph-mcp-server/scripts/eurio_bulk.py import \
  --manifest manifest.json --archive organisations.zip --output organisations.sqlite \
  --sha256 <archive_sha256-from-download-receipt.json>
```

Retain the ZIP, manifest, download receipt and SQLite file together. Download computes SHA-256 from the entire response; it does not claim provider checksum verification. Import is offline, verifies compressed size and SHA-256 before and after scanning the same open file, and checks each ZIP member's CRC. Defaults cap downloads at 1 GiB, total uncompressed members at 8 GiB and each RDF line at 1 MiB; raise explicit CLI limits only when needed for the selected archive. Redirects, unsafe/unsupported members, malformed RDF, changed bytes and existing output paths fail without publishing a partial snapshot.

The SQLite `snapshot` table retains the original manifest bytes/hash, source URL, archive hash, parser version and completion scope. `files` records each member's hash, size, CRC and verbatim XML metadata. `quads` retains every occurrence, original line, URI/blank-node/literal kind, lexical literal value, language, datatype and named/default graph. Numeric literals such as `"001"` remain lexical strings. **Blank-node identity is scoped by `member_id`**; include it when joining blank nodes across rows. Duplicate quads remain duplicates, and counts are occurrences rather than distinct entities. Indexes support subject, predicate and URI-object lookups:

```sql
SELECT predicate, object_kind, object, language, datatype, graph_kind, graph
FROM quads WHERE subject_kind = 'uri' AND subject = '<exact-source-URI>';
SELECT archive_sha256, complete_archive_scan, quad_occurrences FROM snapshot;
```

`complete_archive_scan` covers this pinned ZIP only. It establishes neither a complete current EURIO graph nor temporal identity with live SPARQL responses. Other RDF formats remain discoverable/downloadable; the SQLite importer accepts N-Quads distributions. The importer tests run separately from Vitest:

```bash
python3 -m unittest discover -s servers/funding-graph-mcp-server/scripts -p 'test_*.py'
```

October 3 local acceptance passes 98 additional MCP calls through both aliases, including full catalogue recovery, manifest comparison and citation/error checks. A complete native organisation archive (100,093,870 compressed bytes) imports into 2,730,322 quad occurrences; SQLite integrity, member hashes/CRCs, source-line samples and verbatim metadata all pass. Eighteen sampled statements match current native SPARQL. The archive contains typed literals but no language tags or blank nodes; separate tests cover those cases. Seventy-two server tests and ten Python tests pass. The new bulk routes have not been deployed by this work.

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from NIH RePORTER, NSF, USAspending, CORDIS and stays under the terms of that source: US public domain; CORDIS CC BY 4.0.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
