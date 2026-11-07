import { MCP_BUNDLES, type McpBundle } from "@louez/api/platform/meta";

import type { McpRequestContext } from "./auth/context";

/** What each tool bundle holds, for a model deciding whether to ask for more. */
const BUNDLE_SUMMARY: Record<McpBundle, string> = {
  daily: "reservations, calendar, customers, payments and figures",
  catalog: "products, categories and stock",
  settings: "store settings and the online store",
  integrations: "connected services",
  team: "team members",
  billing: "subscription and invoices from Louez",
};

/**
 * The server's instructions: which store it acts on, and which tool bundles
 * the connection lists. A bundle that is not listed is enabled by the user in
 * Louez, never by the agent.
 */
export function serverInstructions(ctx: McpRequestContext): string {
  const lines = ["Louez runs a rental store: reservations, products, customers and payments."];

  if (ctx.multiStore && !ctx.storeChosen) {
    lines.push(
      "This connection covers several stores. Call stores_list, then pass the store's id as storeId to every other tool.",
    );
  } else if (ctx.multiStore) {
    lines.push(
      `This request acts on the store "${ctx.storeName}" (${ctx.storeId}). Other stores of this connection: stores_list, then storeId.`,
    );
  } else {
    lines.push(`Store: "${ctx.storeName}".`);
  }

  const { bundles } = ctx.actor.credential;
  if (bundles) {
    const listed = MCP_BUNDLES.filter((bundle) => bundles.includes(bundle));
    const others = MCP_BUNDLES.filter((bundle) => !bundles.includes(bundle));
    lines.push(
      `Tool bundles listed: ${listed.map((bundle) => `${bundle} (${BUNDLE_SUMMARY[bundle]})`).join("; ")}.`,
    );
    if (others.length > 0) {
      lines.push(
        `Not listed: ${others.map((bundle) => `${bundle} (${BUNDLE_SUMMARY[bundle]})`).join("; ")}. When the user asks for one of these, tell them to enable the bundle in Louez: Settings > Integrations > MCP > Connected agents. You cannot enable it yourself.`,
      );
    }
  }

  lines.push(
    "Sensitive actions (money, deletion, messages to customers) may answer CONFIRMATION_REQUIRED with a preview: show it to the user and call again with the token only after they agree.",
  );
  return lines.join("\n");
}
