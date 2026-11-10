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

/**
 * The directory whose rules a client follows, beyond what it is withheld:
 * `openai` for ChatGPT and Codex. A tool may have a variant for a directory
 * (`meta.mcp.directory`), served to its clients under the same name, such as
 * stores_create handing the store's creation to the user.
 */
export type AgentDirectory = "openai";

export function agentDirectoryOf(client: {
  clientId: string;
  name: string | null;
}): AgentDirectory | null {
  return isOpenAiClient(client) ? "openai" : null;
}

/** What a client never reaches, nor sees offered: its domains and its bundles. */
export interface ClientWithholding {
  domains: readonly ApiDomain[];
  bundles: readonly McpBundle[];
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
 * fees and open the Checkout of the card Louez charges them on: an OpenAI
 * client neither sees nor calls them, and the user manages billing in Louez.
 */
const OPENAI_WITHHOLDING: ClientWithholding = {
  domains: ["billing"],
  bundles: ["billing"],
  purchases: true,
};

const NOTHING_WITHHELD: ClientWithholding = { domains: [], bundles: [], purchases: false };

/**
 * Whether the client gives its model a tool result's `structuredContent`, so
 * the text block need not repeat it. OpenAI documents it for ChatGPT and
 * Codex ("`structuredContent`: concise data the model can inspect and use in
 * later calls", https://developers.openai.com/plugins/build/mcp-server), and
 * the MCP specification only asks for the copy in a text block for
 * compatibility (SHOULD). Claude's clients document nothing of the kind, so
 * their text keeps the JSON.
 */
export function modelReadsStructuredContent(client: {
  clientId: string;
  name: string | null;
}): boolean {
  return isOpenAiClient(client);
}

/** What `client` never reaches, whatever its grant. */
export function clientWithholding(client: {
  clientId: string;
  name: string | null;
}): ClientWithholding {
  return isOpenAiClient(client) ? OPENAI_WITHHOLDING : NOTHING_WITHHELD;
}
