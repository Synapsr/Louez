import { registeredVendor } from "./agent-destinations";
import type { McpBundle } from "./meta";
import type { ApiDomain } from "./permissions";

/**
 * Rules for an agent's OAuth client that its directory sets, whatever the
 * user granted it.
 */

/** ChatGPT's client id metadata document, which Codex shares (one directory). */
export const CHATGPT_CLIENT_ID = "https://chatgpt.com/oauth/client.json";

/**
 * An OAuth client as the directory rules read it: its id, the whole name it
 * registered, and its registered redirect URIs (`registeredRedirectUris`).
 */
export interface DirectoryClient {
  clientId: string;
  name: string | null;
  redirectUris: readonly string[];
}

/**
 * A client OpenAI publishes: ChatGPT's metadata document, a client whose
 * every redirect URI is on OpenAI's domains (chatgpt.com, openai.com:
 * `registeredVendor`), as only OpenAI receives its codes, or a client that
 * registered itself under OpenAI's names (ChatGPT may use dynamic
 * registration). A name is only what the client declared, which another
 * client could copy; here it only takes tools away from that client.
 */
export function isOpenAiClient(client: DirectoryClient): boolean {
  return (
    client.clientId === CHATGPT_CLIENT_ID ||
    registeredVendor(client.redirectUris) === "chatgpt" ||
    /\b(?:chatgpt|openai|codex)\b/i.test(client.name ?? "")
  );
}

/**
 * A client Anthropic publishes: Claude's metadata document (on claude.ai or
 * claude.com), a client whose every redirect URI is on those domains, or a
 * client that registered itself under Claude's name. As for OpenAI, a name
 * only takes tools away from the client that declared it.
 */
export function isAnthropicClient(client: DirectoryClient): boolean {
  return (
    /^https:\/\/claude\.(?:ai|com)\//.test(client.clientId) ||
    registeredVendor(client.redirectUris) === "claude" ||
    /\bclaude\b/i.test(client.name ?? "")
  );
}

/** The directory an OAuth client is published in, as error tracking names it. */
export type ClientDirectory = "openai" | "anthropic" | "other";

export function clientDirectory(client: DirectoryClient): ClientDirectory {
  if (isOpenAiClient(client)) return "openai";
  if (isAnthropicClient(client)) return "anthropic";
  return "other";
}

/**
 * What a client never reaches, nor sees offered: its domains, its bundles and
 * single procedures.
 */
export interface ClientWithholding {
  domains: readonly ApiDomain[];
  bundles: readonly McpBundle[];
  /** Procedures, by capability id (`ApiMeta.capability`): never listed, a call refused. */
  capabilities: readonly string[];
  /**
   * No prompt or link to buy anything from Louez (AI credits, a plan): an
   * answer says what is missing, never where to pay for it.
   */
  purchases: boolean;
}

/**
 * OpenAI's plugin guidelines (https://developers.openai.com/plugins/plugin-guidelines,
 * "Commerce and monetization") forbid selling digital services, displaying
 * subscription plans, initiating subscriptions and linking to a checkout or
 * transactional page. Louez's billing tools read the store's Louez plan and
 * fees and open the Checkout of the card Louez charges them on, and a new
 * store starts a billing relationship with Louez (stores_create, the only
 * procedure of the `stores` domain an agent reaches): an OpenAI client
 * neither sees nor calls them. The user manages billing and creates stores
 * in Louez (product owner's decision, 2026-11-10: no store creation from
 * ChatGPT, not even through a link).
 *
 * The same rule covers the AI photo tools: products_enhance_image and
 * products_remove_image_background spend AI credits the store buys from
 * Louez, a digital service sold through the agent. An OpenAI client neither
 * sees nor calls them, nor jobs_get, which only follows their jobs (product
 * owner's decision, 2026-11-10). products_use_image_version stays: it is
 * free, and puts back a version made in the dashboard. The user improves
 * photos in Louez.
 */
const OPENAI_WITHHOLDING: ClientWithholding = {
  domains: ["billing", "stores"],
  bundles: ["billing"],
  capabilities: ["products.enhanceImage", "products.removeImageBackground", "jobs.get"],
  purchases: true,
};

/**
 * Anthropic's Software Directory Policy has a server attest that it "does
 * not use AI models to generate images, videos or audio".
 * products_enhance_image redraws a product photo with GPT Image: a Claude
 * client neither sees nor calls it (product owner's decision, 2026-11-10).
 * products_remove_image_background stays for Claude: it cuts the photo out
 * without redrawing it. The user enhances photos in Louez.
 */
const ANTHROPIC_WITHHOLDING: ClientWithholding = {
  domains: [],
  bundles: [],
  capabilities: ["products.enhanceImage"],
  purchases: false,
};

/**
 * Whether the client gives its model a tool result's `structuredContent`, so
 * the text block need not repeat it. OpenAI documents it for ChatGPT and
 * Codex ("`structuredContent`: concise data the model can inspect and use in
 * later calls", https://developers.openai.com/plugins/build/mcp-server), and
 * the MCP specification only asks for the copy in a text block for
 * compatibility (SHOULD). Claude's clients document nothing of the kind, so
 * their text keeps the JSON.
 */
export function modelReadsStructuredContent(client: DirectoryClient): boolean {
  return isOpenAiClient(client);
}

/**
 * What `client` never reaches, whatever its grant. A client that matches
 * several directories (a name copying both) gets every rule.
 */
export function clientWithholding(client: DirectoryClient): ClientWithholding {
  const rules = [
    ...(isOpenAiClient(client) ? [OPENAI_WITHHOLDING] : []),
    ...(isAnthropicClient(client) ? [ANTHROPIC_WITHHOLDING] : []),
  ];
  return {
    domains: rules.flatMap((rule) => rule.domains),
    bundles: rules.flatMap((rule) => rule.bundles),
    capabilities: [...new Set(rules.flatMap((rule) => rule.capabilities))],
    purchases: rules.some((rule) => rule.purchases),
  };
}
