import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createGetSchemaHandler } from "@bio-mcp/shared/staging/utils";

interface SchemaEnv {
	FUNDING_GRAPH_DATA_DO?: unknown;
}

export function registerGetSchema(server: McpServer, env?: SchemaEnv) {
	const handler = createGetSchemaHandler("FUNDING_GRAPH_DATA_DO", "funding_graph");

	server.registerTool(
		"funding_graph_get_schema",
		{
			title: "Get Staged Funding Graph Data Schema",
			description:
				"Get schema information for staged funding graph data. Shows table structures and row counts.",
			inputSchema: {
				data_access_id: z
					.string()
					.min(1)
					.describe("Data access ID for the staged dataset"),
			},
		},
		async (args, extra) => {
			const runtimeEnv = env || (extra as { env?: SchemaEnv })?.env || {};
			return handler(args as Record<string, unknown>, runtimeEnv as Record<string, unknown>);
		},
	);
}
