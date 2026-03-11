import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { restFetch, type RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const REPORTER_BASE = "https://api.reporter.nih.gov/v2";
const NSF_BASE = "https://api.nsf.gov/services/v1";
const CORDIS_BASE = "https://cordis.europa.eu/api/dataextractions";
const USASPENDING_BASE = "https://api.usaspending.gov/api/v2";

interface FundingFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
	accept?: string;
}

type ApiRequest = Parameters<ApiFetchFn>[0];

function fundingFetch(
	baseUrl: string,
	userAgent: string,
	request: ApiRequest,
	opts?: FundingFetchOptions,
): Promise<Response> {
	const headers: Record<string, string> = {
		Accept: opts?.accept ?? "application/json",
		...(opts?.headers ?? {}),
	};

	return restFetch(baseUrl, request.path, request.params, {
		method: request.method,
		body: request.body as Record<string, unknown> | string | undefined,
		headers,
		retryOn: [429, 500, 502, 503],
		retries: opts?.retries ?? 3,
		timeout: opts?.timeout ?? 30_000,
		userAgent,
	});
}

export function reporterFetch(request: ApiRequest): Promise<Response> {
	return fundingFetch(
		REPORTER_BASE,
		"funding-graph-mcp-server/1.0 (bio-mcp; NIH RePORTER)",
		request,
	);
}

export function nsfFetch(request: ApiRequest): Promise<Response> {
	return fundingFetch(
		NSF_BASE,
		"funding-graph-mcp-server/1.0 (bio-mcp; NSF Award Search)",
		request,
	);
}

export function cordisFetch(request: ApiRequest): Promise<Response> {
	return fundingFetch(
		CORDIS_BASE,
		"funding-graph-mcp-server/1.0 (bio-mcp; CORDIS DET)",
		request,
	);
}

export function usaspendingFetch(request: ApiRequest): Promise<Response> {
	return fundingFetch(
		USASPENDING_BASE,
		"funding-graph-mcp-server/1.0 (bio-mcp; USAspending)",
		request,
	);
}
