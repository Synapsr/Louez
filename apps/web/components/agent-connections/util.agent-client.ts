import type { AgentClient } from "@louez/api/contracts/agent-connections";

/**
 * The name the page calls a client by: its vendor's when every code it gets
 * goes to that vendor (`destination`), else the one it declared. Null when
 * it declared none.
 */
export const shownClientName = (client: Pick<AgentClient, "name" | "destination">) =>
  client.destination?.name ?? client.name;

/**
 * The declared name worth showing under the vendor's: only when it says
 * something else than the vendor's name (case and spaces aside).
 */
export const otherDeclaredName = (client: Pick<AgentClient, "name" | "destination">) => {
  const declared = client.name?.trim();
  if (!declared || !client.destination) return null;
  return declared.toLowerCase() === client.destination.name.toLowerCase() ? null : declared;
};
