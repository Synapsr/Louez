/**
 * Host-header helpers shared by the proxy (routing), the server-side host
 * resolution (`util.storefront-host.ts`), the oRPC client (`x-store-slug`) and
 * the SEO routes. Pure on purpose: the proxy bundle must not import the
 * validated env, and the client bundle must not import server modules — every
 * caller passes the domain it already holds.
 */

/**
 * Extract the subdomain from a host header, relative to the app domain.
 *
 * Examples (with appDomain "example.com"):
 *   "app.example.com" → "app"
 *   "myboutique.example.com" → "myboutique"
 *   "example.com" → null
 *   "localhost:3000" → null (localhost has no subdomains)
 */
export const getSubdomain = (host: string, appDomain: string): string | null => {
  // Remove port if present
  const hostname = host.split(":")[0];

  // Localhost and 127.0.0.1 don't support subdomains
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return null;
  }

  // Extract subdomain by comparing with base domain
  const hostParts = hostname.split(".");
  const baseDomain = appDomain.split(":")[0];
  const baseParts = baseDomain.split(".");

  // If hostname has more parts than base domain, extract subdomain(s)
  if (hostParts.length > baseParts.length) {
    return hostParts.slice(0, hostParts.length - baseParts.length).join(".");
  }

  return null;
};

export const isLoopbackHost = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname === "[::1]";

export interface StorefrontHostRule {
  /** NEXT_PUBLIC_APP_DOMAIN, port included or not. */
  appDomain: string;
  /** NEXT_PUBLIC_DASHBOARD_SUBDOMAIN — the one subdomain that is not a store. */
  dashboardSubdomain: string;
}

/**
 * The store slug a host serves, or null when the host is not a storefront
 * (dashboard, www, apex, localhost). Single owner of the "which hosts are
 * storefronts" rule: the server link prefix, robots.txt, the sitemap and the
 * oRPC store header all agree on it.
 */
export const getStorefrontSlugFromHost = (
  host: string,
  { appDomain, dashboardSubdomain }: StorefrontHostRule,
): string | null => {
  const subdomain = getSubdomain(host, appDomain);

  if (!subdomain || subdomain === "www" || subdomain === dashboardSubdomain) {
    return null;
  }

  return subdomain;
};
