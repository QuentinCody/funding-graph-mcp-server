import { afterEach, expect, it, vi } from "vitest";
import { createFundingGraphApiFetch } from "./api-adapter";
import { digest, readText } from "./response";

const api = createFundingGraphApiFetch();
const catalogue = { result: { id: "named-graphs-from-eurio-knowledge-graph", distributions: [] } };
const cases = [
  { path: "/reporter/projects/search", method: "POST", data: { meta: { total: 2 }, results: [{ appl_id: 1 }] } },
  { path: "/reporter/publications/search", method: "POST", data: { meta: { total: 2 }, results: [{ pmid: 1 }] } },
  { path: "/nsf/awards.json", method: "GET", data: { response: { award: [{ id: "001" }] } } },
  { path: "/cordis/getExtractionStatus", method: "GET", data: { status: "running" } },
  { path: "/usaspending/search/spending_by_award/", method: "POST", data: { results: [] } },
  { path: "/usaspending/awards/1/", method: "GET", data: { id: 1 } },
  { path: "/eurio/project", method: "GET", params: { project_id: "1" }, data: { head: { vars: [] }, results: { bindings: [] } } },
  { path: "/eurio/dumps", method: "GET", data: catalogue },
];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each(cases)("rejects HTTP 206 for $path", async ({ data, ...request }) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(data, { status: 206 })));
  await expect(api(request)).rejects.toMatchObject({ status: 502 });
});
it.each(cases)("rejects Content-Range on HTTP 200 for $path", async ({ data, ...request }) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(data, { headers: { "content-range": "bytes 0-10/100" } })));
  await expect(api(request)).rejects.toMatchObject({ status: 502 });
});

it.each(["1", "999", "1.5", "-1", "9007199254740992", "4194305"])("rejects invalid or mismatched Content-Length %s", async length => {
  await expect(readText(new Response("{}", { headers: { "content-length": length } }))).rejects.toMatchObject({ status: 502 });
});
it("does not compare compressed Content-Length with decoded bytes", async () => {
  expect(await readText(new Response("{}", { headers: { "content-length": "1", "content-encoding": "gzip" } }))).toBe("{}");
});
it("preserves split BOM and UTF-8 bytes with Workers-supported decoder options", async () => {
  const NativeDecoder = TextDecoder;
  vi.stubGlobal("TextDecoder", class extends NativeDecoder {
    constructor(label?: string, options?: TextDecoderOptions) {
      if (options?.ignoreBOM) throw new Error("Workers rejects ignoreBOM:true");
      super(label, options);
    }
  });
  const raw = '\uFEFF{\r\n"text":" λ🧬 "\r\n}';
  const bytes = new TextEncoder().encode(raw);
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  expect(await readText(new Response(body, { headers: { "content-length": String(bytes.length) } }))).toBe(raw);
});
it("retains the BOM in native source hashes while parsing JSON", async () => {
  const raw = '\uFEFF{\r\n"id":1,"future":{"label":"λ🧬"}\r\n}';
  vi.stubGlobal("fetch", vi.fn(async () => new Response(raw, { headers: { "content-type": "application/json" } })));
  expect((await api({ method: "GET", path: "/usaspending/awards/1/" })).data).toMatchObject({ id: 1, future: { label: "λ🧬" }, _funding: { response_sha256: await digest(raw) } });
});
it("parses a complete BOM-prefixed NIH page without changing its envelope", async () => {
  const data = { meta: { total: 2 }, results: [{ appl_id: 1, text: " λ🧬 " }], future: [null, 0, false] };
  vi.stubGlobal("fetch", vi.fn(async () => new Response('\uFEFF' + JSON.stringify(data), { headers: { "content-type": "application/json" } })));
  expect(await api({ method: "POST", path: "/reporter/projects/search", body: { limit: 1 } })).toEqual({ status: 200, data });
});
it("bounds a stalled body and cancels without waiting for acknowledgement", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{"partial":')); }, cancel });
  const result = readText(new Response(body)).catch(error => error);
  await vi.advanceTimersByTimeAsync(30_000);
  const outcome = await Promise.race([result, Promise.resolve("still pending")]);
  expect(outcome).toMatchObject({ status: 504, message: expect.stringContaining("deadline") });
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("rejects partial headers before consuming a stalled or sensitive error body", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const body = new ReadableStream<Uint8Array>({ cancel });
  const result = readText(new Response(body, { status: 206 })).catch(error => error);
  await vi.advanceTimersByTimeAsync(1);
  const outcome = await Promise.race([result, Promise.resolve("still pending")]);
  expect(outcome).toMatchObject({ status: 502 });
  expect(cancel).toHaveBeenCalledTimes(1);
});
it("sanitizes a stream failure that might echo DET credentials", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("key=fixture-secret")); } });
  const error = await readText(new Response(body)).catch(error => error);
  expect(error).toMatchObject({ status: 502 });
  expect(String(error)).not.toContain("fixture-secret");
});
it("preserves complete non-JSON text without changing job-status semantics", async () => {
  const raw = '\uFEFF<extraction status="running">λ</extraction>\r\n';
  vi.stubGlobal("fetch", vi.fn(async () => new Response(raw, { status: 202, headers: { "content-type": "application/xml" } })));
  expect(await api({ method: "GET", path: "/cordis/getExtractionStatus" })).toEqual({ status: 202, data: raw });
});
it.each([200, 206])("rejects partial archive HEAD metadata with status %s", async status => {
  const id = "ccd8fbad-6a0b-4061-8321-24c4c6aaf329";
  const data = { result: { ...catalogue.result, distributions: [{ id, download_url: ["https://cordis.europa.eu/data/cordis-organisationNamedGraph-nq.zip"] }] } };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "HEAD"
    ? new Response(null, { status, headers: { "content-length": "100", etag: '"fixture"', "content-range": "bytes 0-99/1000" } })
    : Response.json(data)));
  await expect(api({ method: "GET", path: "/eurio/dump-manifest", params: { distribution_id: id } })).rejects.toMatchObject({ status: 502 });
});
it("sanitizes invalid JSON that contains a DET credential echo", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response('{"key":"fixture-secret",}', { headers: { "content-type": "application/json" } })));
  const error = await api({ method: "GET", path: "/cordis/getExtractionStatus" }).catch(error => error);
  expect(error).toMatchObject({ status: 502, message: "Funding provider returned invalid JSON" });
  expect(String(error)).not.toContain("fixture-secret");
});
it.each([Uint8Array.of(0xc3, 0x28), Uint8Array.of(0xe2, 0x82)])("rejects invalid or unfinished UTF-8", async bytes => {
  await expect(readText(new Response(bytes))).rejects.toMatchObject({ status: 502, message: "Funding provider returned invalid UTF-8" });
});
