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
		const { path, fetcher } = pickFetcher(request.path);
		const response = await fetcher({
			...request,
			path,
		});

		if (!response.ok) {
			let errorBody: string;
			try {
				errorBody = await response.text();
			} catch {
				errorBody = response.statusText;
			}
			const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
				status: number;
				data: unknown;
			};
			error.status = response.status;
			error.data = errorBody;
			throw error;
		}

		const contentType = response.headers.get("content-type") || "";
		if (!contentType.includes("json")) {
			const text = await response.text();
			return { status: response.status, data: text };
		}

		const data = await response.json();
		return { status: response.status, data };
	};
}
