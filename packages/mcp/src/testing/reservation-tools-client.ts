/**
 * The reservation tools behind an in-memory MCP client, for tests: calls go
 * through the SDK, which validates the arguments as in production.
 *
 * Only these tools. The full server loads @louez/api, whose named imports from
 * @louez/validations (CommonJS) fail when Node loads this package as ESM.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { McpSessionContext } from "../auth/context";
import type { McpReservationDeps } from "../deps";
import { registerReservationTools } from "../tools/reservations";

export interface ToolAnswer {
  /** The text parts, joined. */
  text: string;
  isError: boolean;
}

export interface ReservationToolsClient {
  call(name: string, args: Record<string, unknown>): Promise<ToolAnswer>;
  close(): Promise<void>;
}

export async function connectReservationTools(
  ctx: McpSessionContext,
  deps: McpReservationDeps,
): Promise<ReservationToolsClient> {
  const server = new McpServer({ name: "louez", version: "0.0.0" });
  registerReservationTools(server, ctx, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);

  return {
    async call(name, args) {
      const result = await client.callTool({ name, arguments: args });
      const content: unknown[] = Array.isArray(result.content) ? result.content : [];
      const text = content
        .map((part) =>
          typeof part === "object" && part !== null && "text" in part ? String(part.text) : "",
        )
        .join("");
      return { text, isError: result.isError === true };
    },
    close: () => client.close(),
  };
}
