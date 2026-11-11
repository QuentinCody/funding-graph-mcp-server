import { eurioRead } from "./eurio";
import { eurioDumps } from "./eurio-dumps";
import { usaRead } from "./usaspending";
import { fail, readText } from "./response";
import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { cordisFetch, nsfFetch, reporterFetch, usaspendingFetch } from "./http";

type Fetcher = (request: Parameters<ApiFetchFn>[0]) => Promise<Response>;

function pickFetcher(requestPath: string): { path: string; fetcher: Fetcher } {
	const segments = requestPath.split("/").filter(Boolean);
	const [source, ...rest] = segments;
	const routedPath = `/${rest.join("/")}`;

	switch (source) {
		case "reporter":
			return { path: routedPath, fetcher: reporterFetch };
		case "nsf":
			return { path: routedPath, fetcher: nsfFetch };
		case "cordis":
			return { path: routedPath, fetcher: cordisFetch };
		case "usaspending":
			return { path: routedPath, fetcher: usaspendingFetch };
		default:
			throw new Error(
				`Unknown funding graph API namespace '${source}'. Use paths starting with /reporter, /nsf, /cordis, or /usaspending.`,
			);
	}
}

export function createFundingGraphApiFetch(): ApiFetchFn {
	return async (request) => {
    if (["/eurio/dumps", "/eurio/dump-manifest"].includes(request.path)) return eurioDumps(request);
    if (request.path.startsWith("/eurio/")) return eurioRead(request);
    if (/^\/usaspending\/(?:awards\/[^/]+\/?|transactions\/?)$/.test(request.path)) return usaRead(request);
		const { path, fetcher } = pickFetcher(request.path);
		const response = await fetcher({
			...request,
			path,
		});

    const text = await readText(response);

		const contentType = response.headers.get("content-type") || "";
		if (!contentType.includes("json")) {
			return { status: response.status, data: text };
		}

		let data: unknown;
    try { data = JSON.parse(text.replace(/^\uFEFF/, "")); }
    catch { fail("Funding provider returned invalid JSON", 502); }
		return { status: response.status, data };
	};
}
