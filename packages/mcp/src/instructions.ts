import { HANDOFF_POLL_SECONDS } from "@louez/api/contracts/handoffs";
import { INBOX_POLL_MINUTES } from "@louez/api/contracts/inbox";
import { JOB_WAIT_SECONDS_MAX } from "@louez/api/contracts/jobs";
import { agentConnectionsLinks } from "@louez/api/platform/links";
import { MCP_BUNDLES, type McpBundle } from "@louez/api/platform/meta";
import { accountRefusal } from "@louez/api/platform/permissions";

import type { McpRequestContext } from "./auth/context";

/** What each tool bundle holds, for a model deciding whether to ask for more. */
const BUNDLE_SUMMARY: Record<McpBundle, string> = {
  daily: "reservations, calendar, customers, payments and figures",
  catalog: "products, categories and stock",
  settings: "store settings, the online store and Stripe",
  integrations: "connected services",
  team: "team members and invitations",
  billing: "what Louez bills the store, and its billing card",
};

/** Where an agent learns what needs the user, and how to poll it. */
const INBOX_HELP = `What needs the user's attention (requests to answer, late returns, failed payments, messages that never went out…): inbox_list. To keep an eye on the store, call it every ${INBOX_POLL_MINUTES.min} to ${INBOX_POLL_MINUTES.max} minutes with the nextCursor of your last call: you get only what is new. When hasMore is true, call it again at once with nextCursor.`;

/** Steps only the user can take, handed over with a link (services/handoffs.ts). */
const HANDOFF_HELP = `Some steps only the user can take (Stripe's identity checks, a billing card): their tool returns a link. Give the user that link as it is and never open it yourself, then poll handoffs_get with its id every ${HANDOFF_POLL_SECONDS.min} seconds to ${HANDOFF_POLL_SECONDS.max / 60} minutes (or watch inbox_list) until it is completed, rather than asking them to tell you; while it answers \`confirming: true\` (the user is back, the provider has not confirmed yet), poll handoffs_refresh instead, which asks the provider again. An expired or failed link is replaced by calling the same tool again. Once Stripe's onboarding completes, or when the user says Stripe asked them for something, payments_sync_stripe_status says whether charges are enabled; once a card is added, billing_get_status shows it.`;

/**
 * How the tools chain. Tool descriptions say what each tool does and never
 * tell the agent to call another one (the Claude directory's rule): the order
 * of calls is said here.
 */
const CHAINING_HELP = [
  "To change a product, read it with products_get and send the fields to change to products_update; a product's units, with their ids, are in products_get.",
  "To give a category, a product or the storefront an image: the domain's *_create_image_upload, then the file sent as its upload says, then *_complete_image_upload with the key; set the url it returns on the record.",
  "Check a web address before you use it: stores_check_slug_availability before stores_create, online_store_check_slug_availability before online_store_update_slug.",
  "A variant still used by products: products_get_variant_usage, then products_withdraw_variant, before products_delete_variant.",
  "The store's legal identity: settings_search_company_registry, show the matches to the user, then settings_update_legal_profile with the one they pick (ask them for it when the registry does not answer).",
  "The legal texts: you may draft the terms and the legal notice from the store's data (settings_get, settings_get_legal_profile, the products) and the user's answers to what it lacks (such as the publication director); show the draft to the user and save it with settings_update_legal once they agree. stores_get_launch_checklist says what the law asks of the store's country.",
  "Before stores_go_live, read stores_get_launch_checklist and fix what is missing, or tell the user what is.",
  "After inbox_acknowledge rejects items, call inbox_list without a cursor to start again from what the inbox holds.",
  "The team: team_invite_member invites someone as a member only, and team_remove_member and team_cancel_invitation take access away; each always answers CONFIRMATION_REQUIRED first, whatever the connection's setting, so show the user the preview and ask. Changing a member's role, sending an invitation again or sharing its link is done by the user in Louez: give them the team page link that team_list_members returns.",
  `To improve a product photo: products_enhance_image (AI) or products_remove_image_background, with one of the product's images. They spend AI credits, so a paid run always answers CONFIRMATION_REQUIRED first: show the user the price and ask. The photo is processed in the background: poll jobs_get with the job's id (waitSeconds up to ${JOB_WAIT_SECONDS_MAX}) until it is succeeded or failed, and never start the same photo again while its job runs. Once it succeeds, the result has replaced the photo on the product: show the user the before and after images (the job's source.url and result.url); to undo, products_use_image_version with the original's id (the job's source.versionId). A photo's versions are in imageVersions of products_get.`,
].join(" ");

/** How a new store goes live, for a model that just created one. */
const LAUNCH_HELP =
  "A new store starts offline: stores_get_launch_checklist says what it still lacks and which tool fixes each item; stores_go_live puts it online once the user agrees with its preview.";

/** Clients may read only this much of the instructions (ChatGPT): the essentials come first. */
export const INSTRUCTIONS_ESSENTIALS_MAX = 512;

/** Records come with links; the agent never makes one up. */
const LINKS_ESSENTIAL =
  "Give the user the `links` records come with, as they are; never build or guess a Louez URL.";

/** Sensitive actions confirm with the user first. */
const CONFIRMATION_ESSENTIAL =
  "A sensitive action (money, deletion, a message to a customer) may answer CONFIRMATION_REQUIRED with a preview: show it to the user, and call again with its confirmationToken only once they agree.";

/**
 * The server's instructions. The essentials first, within
 * `INSTRUCTIONS_ESSENTIALS_MAX` characters: what Louez is, which store the
 * connection acts on (stores_list first when it covers several), the links,
 * the confirmations. Then the details: the store, how it goes live, the
 * inbox, the handoffs and the tool bundles. A bundle that is not listed is
 * enabled by the user in Louez, never by the agent.
 */
export function serverInstructions(ctx: McpRequestContext): string {
  const mayCreateStores =
    accountRefusal(ctx.actor.credential, { domain: "stores", level: "write" }) === null;

  let stores: string;
  if (ctx.noStore) {
    stores = mayCreateStores
      ? "This account has no store yet: stores_create makes one."
      : "This connection reaches no store yet: the user creates one in Louez.";
  } else if (ctx.multiStore) {
    stores =
      "This connection covers several stores: call stores_list first, then pass the store's id as storeId to every other tool.";
  } else {
    stores = "This connection acts on one store.";
  }
  const lines = [
    "Louez runs rental stores: reservations, products, customers and payments.",
    stores,
    LINKS_ESSENTIAL,
    CONFIRMATION_ESSENTIAL,
  ];

  if (ctx.noStore) {
    lines.push(
      mayCreateStores
        ? `To start one: stores_check_slug_availability for its web address, then stores_create. Pass the new store's id as storeId to the other tools. ${LAUNCH_HELP}`
        : "The user creates a store in Louez, or connects this agent again with “Read and edit” rights on all their stores, so that it can create one with stores_create.",
    );
  } else if (ctx.multiStore && ctx.storeChosen) {
    lines.push(
      `This request acts on the store "${ctx.storeName}" (${ctx.storeId}). Other stores of this connection: stores_list, then storeId.`,
    );
  } else if (!ctx.multiStore) {
    lines.push(`Store: "${ctx.storeName}".`);
  }
  const offline = !ctx.noStore && ctx.storeChosen && !ctx.storeOnline;
  if (offline) lines.push(`This store is not online yet. ${LAUNCH_HELP}`);
  if (!ctx.noStore && mayCreateStores) {
    lines.push(
      `To start another store for the user: stores_create.${offline ? "" : ` ${LAUNCH_HELP}`}`,
    );
  }

  if (!ctx.noStore) lines.push(INBOX_HELP, HANDOFF_HELP);

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
    "Records come with `links`: absolute URLs to their page in the Louez dashboard and, when the public can see it, on the store's online store. When the user wants to see or open something, give them these URLs as they are. Without a link, name the record instead.",
    CHAINING_HELP,
  );
  return lines.join("\n");
}
