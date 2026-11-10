/**
 * Where an OAuth client's authorization code can go, and the vendor that owns
 * it. A client names itself (dynamic registration, or a metadata document
 * any host can serve), but the code only ever reaches one of its registered
 * redirect URIs: when every one of them is on one vendor's domain, the code
 * can reach nobody but that vendor, whatever the client calls itself. The
 * consent page then shows the vendor rather than the declared name (product
 * owner's decision, 2026-11-10).
 */

export const AGENT_VENDORS = ["cursor", "grok", "chatgpt", "claude"] as const;
export type AgentVendor = (typeof AGENT_VENDORS)[number];

/**
 * Each vendor's brand name, the same in every language, and the domains it
 * owns: a redirect URI on one of them, or on a subdomain, is the vendor's.
 * The redirect URIs each client uses, as published (read 2026-11-10):
 * - Cursor: `https://www.cursor.com/agents/mcp/oauth/callback` and
 *   `https://www.cursor.com/bot/mcp/oauth/callback`, in Cursor's metadata
 *   document (https://cursor.com/oauth/mcp-client.json), which also lists
 *   grok.com and loopback ones.
 * - Grok: `https://grok.com/connectors-oauth-exchange-code/` (grok.com's
 *   connectors, also in Cursor's document). x.ai is xAI's own domain.
 * - ChatGPT: `https://chatgpt.com/connector_platform_oauth_redirect`, and
 *   `https://chatgpt.com/connector/oauth/{callback_id}` when it registers
 *   itself (https://developers.openai.com/plugins/build/auth). openai.com is
 *   OpenAI's own domain.
 * - Claude: `https://claude.ai/api/mcp/auth_callback`
 *   (https://claude.com/docs/connectors/building/authentication). claude.com
 *   is Anthropic's own domain.
 */
const VENDOR_DOMAINS: Readonly<Record<AgentVendor, { name: string; domains: readonly string[] }>> =
  {
    cursor: { name: "Cursor", domains: ["cursor.com"] },
    grok: { name: "Grok", domains: ["grok.com", "x.ai"] },
    chatgpt: { name: "ChatGPT", domains: ["chatgpt.com", "openai.com"] },
    claude: { name: "Claude", domains: ["claude.ai", "claude.com"] },
  };

/** A redirect URI that only a vendor receives: the vendor and its domain the URI is on. */
export interface VendorRedirect {
  vendor: AgentVendor;
  /** The vendor's domain, as in the table (`cursor.com` for `www.cursor.com`). */
  domain: string;
}

const HTTPS = "https://";

/**
 * The vendor whose domain `uri` is on, or null. Strict, as a mistake here
 * would vouch for a stranger: `https:` only, printable ASCII without a
 * backslash (nothing a parser would rewrite: tabs, newlines, `\` for `/`,
 * an internationalized host), and an authority that is the host alone as
 * written, so no user info, no port (443 included), no percent escape, no
 * empty label (a trailing dot included). The host must be the vendor's
 * domain or end in `.` + it: `cursor.com.evil.test`, `evilcursor.com` and
 * `evil.test/cursor.com` are not Cursor's. Case does not matter.
 */
export function vendorOfRedirect(uri: string): VendorRedirect | null {
  if (!/^[\x21-\x7e]+$/.test(uri) || uri.includes("\\")) return null;
  if (uri.slice(0, HTTPS.length).toLowerCase() !== HTTPS) return null;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname;
  const authority = uri.slice(HTTPS.length).split(/[/?#]/, 1)[0]?.toLowerCase();
  if (authority !== host || host.split(".").includes("")) return null;
  for (const vendor of AGENT_VENDORS) {
    const domain = VENDOR_DOMAINS[vendor].domains.find(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`),
    );
    if (domain) return { vendor, domain };
  }
  return null;
}

/** The client's vendor, as the consent page names it. */
export interface VerifiedDestination extends VendorRedirect {
  /** The vendor's brand name, from the table, never the client's. */
  name: string;
}

/**
 * The vendor that alone receives a client's codes: every registered redirect
 * URI, and this request's when there is one, on the domains of one vendor.
 * The domain shown is the one this request's code goes to, else the first
 * registered URI's. Null when one URI is elsewhere (loopback, a custom
 * scheme, another host, another vendor) or none is registered.
 */
export function verifiedDestination(input: {
  registered: readonly string[];
  requested: string | null;
}): VerifiedDestination | null {
  if (input.registered.length === 0) return null;
  const all = [...input.registered, ...(input.requested === null ? [] : [input.requested])];
  const matches = all.map(vendorOfRedirect);
  const [first] = matches;
  if (!first || matches.some((match) => match?.vendor !== first.vendor)) return null;
  const shown = (input.requested === null ? first : matches.at(-1)) ?? first;
  return { vendor: first.vendor, domain: shown.domain, name: VENDOR_DOMAINS[first.vendor].name };
}

/**
 * A client's registered redirect URIs, from the column Better Auth stores
 * them in (a JSON array of strings). Anything else reads as none, so the
 * client is not vouched for.
 */
export function registeredRedirectUris(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((uri) => typeof uri === "string") ? parsed : [];
  } catch {
    return [];
  }
}
