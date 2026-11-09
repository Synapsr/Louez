import type { McpBundle } from "./meta";
import type { ApiDomain } from "./permissions";

/**
 * Rules for an agent's OAuth client that its directory sets, whatever the
 * user granted it.
 */

/** ChatGPT's client id metadata document, which Codex shares (one directory). */
export const CHATGPT_CLIENT_ID = "https://chatgpt.com/oauth/client.json";

/**
 * A client OpenAI publishes: ChatGPT's metadata document, or a client that
 * registered itself under OpenAI's names (ChatGPT may use dynamic
 * registration). A name is only what the client declared, which another
 * client could copy; here it only takes tools away from that client.
 */
export function isOpenAiClient(client: { clientId: string; name: string | null }): boolean {
  return (
    client.clientId === CHATGPT_CLIENT_ID || /\b(?:chatgpt|openai|codex)\b/i.test(client.name ?? "")
  );
}

/** What a client never reaches, nor sees offered: its domains and its bundles. */
export interface ClientWithholding {
  domains: readonly ApiDomain[];
  bundles: readonly McpBundle[];
}

/**
 * OpenAI's plugin guidelines (https://developers.openai.com/plugins/plugin-guidelines,
 * "Commerce and monetization") forbid selling digital services, displaying
 * subscription plans, initiating subscriptions and linking to a checkout or
 * transactional page. Louez's billing tools read the store's Louez plan and
 * fees and open the Checkout of the card Louez charges them on: an OpenAI
 * client neither sees nor calls them, and the user manages billing in Louez.
 */
const OPENAI_WITHHOLDING: ClientWithholding = { domains: ["billing"], bundles: ["billing"] };

const NOTHING_WITHHELD: ClientWithholding = { domains: [], bundles: [] };

/** What `client` never reaches, whatever its grant. */
export function clientWithholding(client: {
  clientId: string;
  name: string | null;
}): ClientWithholding {
  return isOpenAiClient(client) ? OPENAI_WITHHOLDING : NOTHING_WITHHELD;
}
