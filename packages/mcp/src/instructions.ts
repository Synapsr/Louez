import { INBOX_POLL_MINUTES } from "@louez/api/contracts/inbox";
import { agentConnectionsLinks } from "@louez/api/platform/links";
import { MCP_BUNDLES, type McpBundle } from "@louez/api/platform/meta";
import { accountRefusal } from "@louez/api/platform/permissions";

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

/** Where an agent learns what needs the user, and how to poll it. */
const INBOX_HELP = `What needs the user's attention (requests to answer, late returns, failed payments, messages that never went out…): inbox_list. To keep an eye on the store, call it every ${INBOX_POLL_MINUTES.min} to ${INBOX_POLL_MINUTES.max} minutes with the nextCursor of your last call: you get only what is new.`;

/** How a new store goes live, for a model that just created one. */
const LAUNCH_HELP =
  "A new store starts offline: stores_get_launch_checklist says what it still lacks and which tool fixes each item; stores_go_live puts it online once the user agrees with its preview.";

/**
 * The server's instructions: which store it acts on, and which tool bundles
 * the connection lists. A bundle that is not listed is enabled by the user in
 * Louez, never by the agent.
 */
export function serverInstructions(ctx: McpRequestContext): string {
  const lines = ["Louez runs a rental store: reservations, products, customers and payments."];
  const mayCreateStores =
    accountRefusal(ctx.actor.credential, { domain: "stores", level: "write" }) === null;

  if (ctx.noStore) {
    lines.push(
      mayCreateStores
        ? `This account has no store yet. To start one: stores_check_slug_availability for its web address, then stores_create. Pass the new store's id as storeId to the other tools. ${LAUNCH_HELP}`
        : "This connection reaches no store yet. The user creates a store in Louez, or connects this agent again with “Read and edit” rights on all their stores, so that it can create one with stores_create.",
    );
  } else if (ctx.multiStore && !ctx.storeChosen) {
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
  const offline = !ctx.noStore && ctx.storeChosen && !ctx.storeOnline;
  if (offline) lines.push(`This store is not online yet. ${LAUNCH_HELP}`);
  if (!ctx.noStore && mayCreateStores) {
    lines.push(
      `To start another store for the user: stores_create.${offline ? "" : ` ${LAUNCH_HELP}`}`,
    );
  }

  if (!ctx.noStore) lines.push(INBOX_HELP);

  const { bundles } = ctx.actor.credential;
  if (bundles) {
    const listed = MCP_BUNDLES.filter((bundle) => bundles.includes(bundle));
    const others = MCP_BUNDLES.filter((bundle) => !bundles.includes(bundle));
    lines.push(
      `Tool bundles listed: ${listed.map((bundle) => `${bundle} (${BUNDLE_SUMMARY[bundle]})`).join("; ")}.`,
    );
    if (others.length > 0) {
      lines.push(
        `Not listed: ${others.map((bundle) => `${bundle} (${BUNDLE_SUMMARY[bundle]})`).join("; ")}. When the user asks for one of these, tell them to enable the bundle in Louez: Settings > Integrations > MCP > Connected agents${ctx.noStore ? "" : ` (${agentConnectionsLinks(ctx.ports.urls, { id: ctx.storeId }).dashboard})`}. You cannot enable it yourself.`,
      );
    }
  }

  lines.push(
    "Records come with `links`: absolute URLs to their page in the Louez dashboard and, when the public can see it, on the store's online store. When the user wants to see or open something, give them these URLs as they are. Never build, guess or shorten a Louez URL; without a link, name the record instead.",
  );
  lines.push(
    "Sensitive actions (money, deletion, messages to customers) may answer CONFIRMATION_REQUIRED with a preview: show it to the user and call again with the token only after they agree.",
  );
  return lines.join("\n");
}
