import { mcpOAuth } from "@louez/auth";

import { env } from "@/env";

export interface McpEndpoint {
  /** `<app>/api/mcp`: the address an assistant is given. */
  mcpUrl: string;
  /** False on an instance without HTTPS: no OAuth, API keys only. */
  oauthAvailable: boolean;
}

/** Where an assistant connects to Louez, as the connect guide shows it. */
export const getMcpEndpoint = (): McpEndpoint => ({
  // The OAuth resource when the instance serves OAuth: the URL tokens are bound to.
  mcpUrl: mcpOAuth?.resource ?? `${new URL(env.NEXT_PUBLIC_APP_URL).origin}/api/mcp`,
  oauthAvailable: mcpOAuth !== null,
});
