import { orpc } from "@/lib/orpc/react";

/**
 * Agent connections (OAuth grants): the consent page and the "Agents
 * connectés" section of the MCP settings. Session-only procedures.
 */
export const agentConnectionsQueries = {
  /** What the consent page shows for a pending authorization. */
  authorization: (oauthQuery: string) =>
    orpc.dashboard.agentConnections.getAuthorization.queryOptions({
      input: { oauthQuery },
      // A signed query is valid ten minutes and read once: no refetch.
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  list: () => orpc.dashboard.agentConnections.list.queryOptions({ input: {} }),
};

export const agentConnectionsMutations = {
  authorize: () => orpc.dashboard.agentConnections.authorize.mutationOptions(),
  update: () => orpc.dashboard.agentConnections.update.mutationOptions(),
  revoke: () => orpc.dashboard.agentConnections.revoke.mutationOptions(),
};

/** Invalidates the list after a change. */
export const agentConnectionsKey = () => orpc.dashboard.agentConnections.list.key();
