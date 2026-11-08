import { DASHBOARD_STORE_PARAM } from "@louez/api/platform/links";

/**
 * Dashboard links that name their store (`/dashboard/…?store=<id>`, or the
 * online store editor's `/online-store/…?store=<id>`, built by
 * the API's link helpers for agents and the in-app assistant). The proxy
 * hands such a request to the active-store route. A GET never changes the
 * store: it sends the browser to the same URL without the parameter, or, for
 * another store of the user, to a page where they confirm, which POSTs back
 * to the route. The dashboard URL the user ends on never keeps the parameter.
 */

/** The route that reads such a link, and switches the store on a confirmed POST. */
export const ACTIVE_STORE_ROUTE = "/api/active-store";
/** The page where the user confirms a switch to another of their stores. */
export const ACTIVE_STORE_CONFIRM_PAGE = "/active-store";
/** Its parameter holding the dashboard URL to go back to. */
export const ACTIVE_STORE_NEXT_PARAM = "next";

// Next.js marks its own data requests with this; it is not part of the page URL.
const FLIGHT_PARAM = "_rsc";

const DEFAULT_PATH = "/dashboard";

/** The store's own pages: the dashboard and the online store editor. */
const STORE_PAGE_ROOTS = [DEFAULT_PATH, "/online-store"];

const isDashboardPathname = (pathname: string) =>
  STORE_PAGE_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));

/**
 * The internal URL (path and query) of the active-store route for a
 * dashboard request that names a store, or null for any other request.
 */
export const activeStoreSwitchPath = (url: URL): string | null => {
  if (!isDashboardPathname(url.pathname)) return null;
  const storeId = url.searchParams.get(DASHBOARD_STORE_PARAM);
  if (storeId === null) return null;

  const rest = new URLSearchParams(url.searchParams);
  rest.delete(DASHBOARD_STORE_PARAM);
  rest.delete(FLIGHT_PARAM);
  const query = rest.toString();
  const params = new URLSearchParams({
    [DASHBOARD_STORE_PARAM]: storeId,
    [ACTIVE_STORE_NEXT_PARAM]: `${url.pathname}${query ? `?${query}` : ""}`,
  });
  return `${ACTIVE_STORE_ROUTE}?${params.toString()}`;
};

/**
 * The dashboard path to go back to: a relative path under `/dashboard` or
 * `/online-store` with no `store` parameter, or `/dashboard`. Anything else (another origin,
 * `//host`, another page of the app) is refused, so the route never
 * redirects elsewhere.
 */
export const dashboardReturnPath = (next: string | null): string => {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return DEFAULT_PATH;
  }
  let url: URL;
  try {
    // A fixed base only to parse: the path must stay on it.
    url = new URL(next, "http://dashboard.invalid");
  } catch {
    return DEFAULT_PATH;
  }
  if (url.origin !== "http://dashboard.invalid" || !isDashboardPathname(url.pathname)) {
    return DEFAULT_PATH;
  }
  url.searchParams.delete(DASHBOARD_STORE_PARAM);
  url.searchParams.delete(FLIGHT_PARAM);
  return `${url.pathname}${url.search}`;
};

/** The confirmation page for a switch to `storeId`, then back to `next`. */
export const activeStoreConfirmPath = (storeId: string, next: string): string =>
  `${ACTIVE_STORE_CONFIRM_PAGE}?${new URLSearchParams({
    [DASHBOARD_STORE_PARAM]: storeId,
    [ACTIVE_STORE_NEXT_PARAM]: next,
  })}`;

/**
 * Whether a POST comes from this app's own pages: an `Origin` among
 * `origins`, and, when the browser sends it, `Sec-Fetch-Site: same-origin`.
 * A request without an `Origin` is refused.
 */
export const isSameOriginPost = (headers: Headers, origins: readonly string[]): boolean => {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = headers.get("origin");
  return origin !== null && origins.includes(origin);
};
