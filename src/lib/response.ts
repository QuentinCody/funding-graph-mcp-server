export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export async function readText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  const cancel = () => { void reader?.cancel().catch(() => undefined); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Do not consume/echo rejected bodies: DET may reflect its query-string key.
    if (!response.ok) fail(`Funding provider HTTP ${response.status}`, response.status);
    if (response.status === 206 || response.headers.has("content-range")) fail("Funding provider returned a partial HTTP response", 502);
    if (!reader) fail("Funding provider returned an empty response", 502);
    const header = response.headers.get("content-length");
    const expected = header === null ? undefined : Number(header);
    if (header !== null && (!/^\d+$/.test(header) || !Number.isSafeInteger(expected) || expected! > 4 * 1024 * 1024)) fail("Funding provider has an invalid or oversized Content-Length", 502);
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error("Funding provider body deadline exceeded"), { status: 504 }));
        cancel();
      }, 30_000);
    });
    const text = await Promise.race([readBody(reader, response, expected), deadline]);
    if (/^\s*(?:<html\b|<!doctype\s+html)/i.test(text)) fail("Funding provider returned an HTML page", 502);
    return text;
  } finally { clearTimeout(timer); cancel(); reader?.releaseLock(); }
}

/** Keep decoded bytes exact for source hashes; headers retain their existing fetch budgets. */
async function readBody(reader: ReadableStreamDefaultReader<Uint8Array>, response: Response, expected?: number): Promise<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const prefix: number[] = [];
  let size = 0;
  let text = "";
  const decode = (value?: Uint8Array) => {
    try { return decoder.decode(value, { stream: value !== undefined }); }
    catch { fail("Funding provider returned invalid UTF-8", 502); }
  };
  while (true) {
    // A stream implementation can throw a URL-bearing error; never propagate it.
    const { done, value } = await reader.read().catch(() => fail("Funding provider response stream failed", 502));
    if (done) break;
    size += value.byteLength;
    if (size > 4 * 1024 * 1024) fail("Funding provider response exceeds 4 MiB; narrow the request", 502);
    for (let index = 0; prefix.length < 3 && index < value.length; index++) prefix.push(value[index]);
    text += decode(value);
  }
  if (expected !== undefined && !response.headers.has("content-encoding") && size !== expected) fail("Funding provider response length differs from Content-Length", 502);
  const bom = prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf ? "\uFEFF" : "";
  return bom + text + decode();
}
export function parseObject(text: string): Record<string, unknown> {
  let data: unknown;
  try { data = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { fail("Funding provider returned invalid JSON", 502); }
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("Invalid funding response envelope", 502);
  if (("error" in data && data.error) || ("detail" in data && typeof data.detail === "string")) fail("Funding provider returned an error envelope", 502);
  return data as Record<string, unknown>;
}
export async function digest(text: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function integer(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
export function only(data: Record<string, unknown>, fields: string[]): void {
  for (const key of Object.keys(data)) if (!fields.includes(key)) fail(`Unsupported parameter ${key}`);
}
