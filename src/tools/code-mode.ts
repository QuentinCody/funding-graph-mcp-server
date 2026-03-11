/**
 * Scholarly Graph Code Mode — registers search + execute tools for full API access.
 *
 * search: In-process catalog query.
 * execute: V8 isolate with api.get/api.post + searchSpec/listCategories.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { fundingGraphCatalog } from "../spec/catalog";
import { createFundingGraphApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
	FUNDING_GRAPH_DATA_DO: DurableObjectNamespace;
	CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
	server: McpServer,
	env: CodeModeEnv,
) {
	const apiFetch = createFundingGraphApiFetch();

	const searchTool = createSearchTool({
		prefix: "funding_graph",
		catalog: fundingGraphCatalog,
	});
	searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

	const executeTool = createExecuteTool({
		prefix: "funding_graph",
		catalog: fundingGraphCatalog,
		apiFetch,
		doNamespace: env.FUNDING_GRAPH_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
