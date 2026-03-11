/**
 * API Proxy source — pure JS injected into V8 isolates.
 *
 * Provides an `api` object with .get() and .post() methods that route
 * through the hidden __api_proxy tool back to the server's HTTP layer.
 * API keys never enter the isolate.
 *
 * Large responses (>30KB) are auto-staged into SQLite. When this happens,
 * the result has `__staged: true` with a `data_access_id` and `schema`.
 * Common data-access patterns (.results, .data, .entries, iteration) throw
 * a clear error directing the LLM to return the staging info and use query_data.
 */
/**
 * Returns the JS source string to inject into V8 isolates.
 * Relies on `codemode` proxy being available (from evaluator prefix).
 */
export declare function buildApiProxySource(): string;
//# sourceMappingURL=api-proxy.d.ts.map