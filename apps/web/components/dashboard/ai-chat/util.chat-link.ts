import { DASHBOARD_STORE_PARAM } from "@louez/api/platform/links";

/** What a link in an assistant answer opens. */
export type ChatLink =
  /** A page of this app's dashboard, in the current store: a relative path, opened in the app. */
  | { kind: "app"; href: string }
  /**
   * A dashboard page of another store: a full page load in the same tab, so
   * nothing of the current store's client state (store context, query cache)
   * carries over; the app asks before switching stores.
   */
  | { kind: "document"; href: string }
  /** A storefront of this deployment: opened in a new tab. */
  | { kind: "external"; href: string };

/** This deployment's addresses, from its public settings. */
export interface ChatLinkSite {
  /** NEXT_PUBLIC_APP_URL: the dashboard's origin. */
  appUrl: string;
  /** NEXT_PUBLIC_APP_DOMAIN: storefronts live on it or on a subdomain of it. */
  appDomain: string;
  /** The store the dashboard shows now. */
  currentStoreId: string;
}

const isDashboardPath = (pathname: string) =>
  pathname === "/dashboard" || pathname.startsWith("/dashboard/");

const parse = (href: string, base?: string): URL | null => {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
};

/**
 * Decides what a link the assistant wrote becomes. The tools give it absolute
 * links built from this deployment's settings (`links` in their answers):
 *
 * - a dashboard page on this app's origin opens in the app (Next.js Link,
 *   relative path, same tab), as does a bare `/dashboard/…` path; a link
 *   naming the current store (`?store=`) drops it, and one naming another
 *   store is a full page load instead;
 * - a page of this deployment's storefronts, on the app domain or a store
 *   subdomain of it, or on the app's origin in standalone mode or with local
 *   path routing, opens in a new tab;
 * - anything else (another site, another scheme, the app's API) is null and
 *   renders as plain text: a model invention, or a link copied from a
 *   customer's note.
 */
export const resolveChatLink = (href: string, site: ChatLinkSite): ChatLink | null => {
  const appOrigin = parse(site.appUrl)?.origin;
  if (!appOrigin || appOrigin === "null") return null;

  const url = parse(href.trim(), appOrigin);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  if (url.username || url.password) return null;

  if (url.origin === appOrigin) {
    if (isDashboardPath(url.pathname)) {
      const store = url.searchParams.get(DASHBOARD_STORE_PARAM);
      if (store !== null && store !== site.currentStoreId) {
        return { kind: "document", href: `${url.pathname}${url.search}${url.hash}` };
      }
      url.searchParams.delete(DASHBOARD_STORE_PARAM);
      return { kind: "app", href: `${url.pathname}${url.search}${url.hash}` };
    }
    // Only an absolute link reaches the app's own storefront paths; a bare
    // path the model wrote must be a dashboard page.
    if (!/^https?:\/\//i.test(href.trim())) return null;
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
    return { kind: "external", href: url.href };
  }

  const domain = site.appDomain.toLowerCase();
  const host = url.host.toLowerCase();
  if (domain && (host === domain || host.endsWith(`.${domain}`))) {
    return { kind: "external", href: url.href };
  }
  return null;
};
