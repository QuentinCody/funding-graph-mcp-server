/**
 * Funding Graph Code Mode — registers search + execute tools for full API access.
 *
 * search: In-process catalog query.
 * execute: V8 isolate with api.get/api.post + searchSpec/listCategories.
 */

import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { fundingGraphCatalog } from "../spec/catalog";
import { createFundingGraphApiFetch } from "../lib/api-adapter";
import { fundingResponse } from "../lib/tool-result";

interface CodeModeEnv {
	FUNDING_GRAPH_DATA_DO: DurableObjectNamespace;
	CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
	server: McpServer,
	env: CodeModeEnv,
): void {
	const apiFetch = createFundingGraphApiFetch();
  const registrar = { tool: (...args: unknown[]) => {
    const [name, ...rest] = args;
    const register = server.tool.bind(server) as (...values: unknown[]) => void;
    const handler = rest.pop() as (args: unknown, extra: unknown) => ReturnType<Parameters<typeof fundingResponse>[0]>;
    const respond = (args: unknown, extra: unknown) => fundingResponse(() => handler(args, extra), env, String(name), extra, args);
    register(name, ...rest, respond);
    register(`mcp_${String(name)}`, ...rest, respond);
  } };

	const searchTool = createSearchTool({
		prefix: "funding_graph",
		catalog: fundingGraphCatalog,
	});
	searchTool.register(registrar);

	const executeTool = createExecuteTool({
		prefix: "funding_graph",
		// Verifiable provenance: funding_graph_execute results carry a _meta.citation.
		source: { id: "funding_graph", name: "Funding Graph" },
		catalog: fundingGraphCatalog,
		apiFetch,
    maxInlineBytes: 30 * 1024,
    stagingThreshold: 30 * 1024,
    preserveApiErrors: true,
    timeout: 90_000,
		doNamespace: env.FUNDING_GRAPH_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(registrar);
}
