import {
  ProtocolError,
  ProtocolErrorCode,
  type CallToolResult,
  type McpServer,
  type Tool,
} from "@modelcontextprotocol/server";

/** A tool as this server serves it. */
export interface ServedTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments; always an object. */
  inputSchema: Tool["inputSchema"];
  annotations?: Tool["annotations"];
  /**
   * Shown by `tools/list`. A tool that is not listed can still be called:
   * the list only shows, the call is authorized where it runs.
   */
  listed: boolean;
  call: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

const registries = new WeakMap<McpServer, Map<string, ServedTool>>();

/**
 * Serves `tools/list` and `tools/call` from our own list instead of the SDK's
 * `registerTool`, which cannot show a subset of what may be called. Resources
 * and prompts stay on the SDK. Add every tool before the server connects.
 */
export function addTool(server: McpServer, tool: ServedTool): void {
  let tools = registries.get(server);
  if (!tools) {
    const created = new Map<string, ServedTool>();
    install(server, created);
    registries.set(server, created);
    tools = created;
  }
  if (tools.has(tool.name)) throw new Error(`MCP tool ${tool.name} is registered twice.`);
  tools.set(tool.name, tool);
}

function install(server: McpServer, tools: Map<string, ServedTool>): void {
  const lowLevel = server.server;
  lowLevel.registerCapabilities({ tools: { listChanged: false } });

  lowLevel.setRequestHandler("tools/list", () => ({
    tools: [...tools.values()]
      .filter((tool) => tool.listed)
      .map(({ name, description, inputSchema, annotations }) => ({
        name,
        description,
        inputSchema,
        ...(annotations ? { annotations } : {}),
      })),
  }));

  lowLevel.setRequestHandler("tools/call", async (request) => {
    const tool = tools.get(request.params.name);
    if (!tool) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Tool ${request.params.name} not found`,
      );
    }
    let result: CallToolResult;
    try {
      result = await tool.call(request.params.arguments ?? {});
    } catch (error) {
      // As the SDK does: a tool that throws answers with its message.
      result = {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
    // Shapes the result for the protocol revision this request speaks.
    return lowLevel.projectCallToolResult(result, undefined);
  });
}
