/**
 * The reservation tools behind an in-memory MCP client, for tests: calls go
 * through the SDK, which validates the arguments as in production.
 *
 * Only these tools, with a context built in memory: the full server and the
 * per-request resolver read the database.
 */
import type { ApiKeyPermissions } from "@louez/db";
import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { normalizeScopes } from "@louez/api/platform/permissions";
import { Client, InMemoryTransport as ClientInMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import type { MemberRole } from "@louez/utils";

import type { McpRequestContext } from "../auth/context";
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

/**
 * A request context as `resolveMcpContext` builds it for an API key, without
 * the database: the key's permissions, the owner's role (owner by default),
 * and no rate limit. `confirmSensitive` is the key's setting (on by default,
 * as for a new key); a test of a sensitive tool's effects turns it off.
 */
export function testRequestContext(input: {
  storeId: string;
  userId: string;
  storeName?: string;
  role?: MemberRole;
  apiKeyId?: string;
  permissions: Partial<ApiKeyPermissions>;
  confirmSensitive?: boolean;
}): McpRequestContext {
  return {
    actor: {
      transport: "mcp",
      isPlatformAdmin: false,
      storeId: input.storeId,
      role: input.role ?? "owner",
      credential: {
        kind: "api_key",
        id: input.apiKeyId ?? "key_test",
        clientName: "Test key",
        userId: input.userId,
        email: null,
        storeId: input.storeId,
        stores: null,
        scopes: normalizeScopes(input.permissions),
        confirmSensitive: input.confirmSensitive ?? true,
        bundles: null,
      },
    },
    storeChosen: true,
    multiStore: false,
    storeError: null,
    listingRole: input.role ?? "owner",
    storeId: input.storeId,
    userId: input.userId,
    storeName: input.storeName ?? "Test store",
    headers: new Headers(),
    ports: {
      planFeatures: async () => ({ apiAccess: true }),
      storage: createMemoryStorage(),
      afterCommit: () => {},
    },
    countCall: async () => undefined,
  };
}

export async function connectReservationTools(
  ctx: McpRequestContext,
  deps: McpReservationDeps,
): Promise<ReservationToolsClient> {
  const server = new McpServer({ name: "louez", version: "0.0.0" });
  registerReservationTools(server, ctx, deps);
  const [clientTransport, serverTransport] = ClientInMemoryTransport.createLinkedPair();
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
