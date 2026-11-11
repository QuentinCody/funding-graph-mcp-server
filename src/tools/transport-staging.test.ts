import { afterEach, expect, it, vi } from "vitest";
import { verifyCitationEnvelope } from "@bio-mcp/shared";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { MyMCP } from "../index";
import { fixture, recover } from "./publication.test-support";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function call(f: ReturnType<typeof fixture>, name: string, args: Record<string, unknown>) {
  const response = await MyMCP.serve("/mcp").fetch(new Request("http://fixture/mcp", {
    method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-method": "tools/call", "mcp-name": name, "mcp-protocol-version": "2026-07-28" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "funding-contract", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {},
    } } }),
  }), f.env as never, { waitUntil() {} } as never);
  expect(response.status).toBe(200);
  const wire = await response.text();
  expect(new TextEncoder().encode(wire).byteLength).toBeLessThan(30720);
  return { wire, output: JSON.parse(wire).result };
}

it("reports rejected provider bodies through both MCP HTTP aliases without credential echoes", async () => {
  let mode = "partial";
  vi.stubGlobal("fetch", vi.fn(async () => new Response('key=fixture-secret', {
    status: mode === "partial" ? 206 : 200,
    headers: { "content-type": "application/json", ...(mode === "range" ? { "content-range": "bytes 0-10/20" } : {}) },
  })));
  const f = fixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      for (mode of ["partial", "range", "json"]) {
        const name = `${prefix}funding_graph_execute`;
        const args = { code: "return await api.get('/cordis/getExtractionStatus');" };
        const { wire, output } = await call(f, name, args);
        expect(wire).not.toContain("fixture-secret");
        expect(output).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false } });
        const verification = await verifyCitationEnvelope({ citation: output.structuredContent._meta.citation, structuredContent: output.structuredContent, toolArguments: args });
        expect(verification.verification).toMatchObject({ query: "verified", result: "verified" });
      }
    }
  } finally { f.close(); }
});

it.each([["x", 29838], ["Ω🧬", 4973]] as const)("stages %s near the wire boundary with complete recovery and citation", async (symbol, count) => {
  const f = fixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      const args = { code: `return {text:${JSON.stringify(symbol)}.repeat(${count})};` };
      const { output } = await call(f, `${prefix}funding_graph_execute`, args);
      expect(output.isError).not.toBe(true);
      expect(output.structuredContent.staged).toBe(true);
      const full = await recover(f, output.structuredContent.data_access_id, prefix);
      expect(full.structuredContent.data.text).toBe(symbol.repeat(count));
      expect(full.content).toEqual(expect.any(Array));
      const verified = await verifyCitationEnvelope({ citation: output.structuredContent._meta.citation, structuredContent: output.structuredContent, toolArguments: args, materialized: { value: full } });
      expect(verified.verification).toMatchObject({ query: "verified", result: "verified" });
    }
  } finally { f.close(); }
});
it("keeps a safely smaller response inline through both aliases", async () => {
  const f = fixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      const args = { code: "return {text:'x'.repeat(28000)};" };
      const { output } = await call(f, `${prefix}funding_graph_execute`, args);
      expect(output.structuredContent.staged).not.toBe(true);
      expect(output.structuredContent.data.text).toBe("x".repeat(28000));
      const checked = await verifyCitationEnvelope({ citation: output.structuredContent._meta.citation, structuredContent: output.structuredContent, toolArguments: args });
      expect(checked.verification).toMatchObject({ query: "verified", result: "verified" });
    }
  } finally { f.close(); }
});
