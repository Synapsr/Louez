import { DASHBOARD_STORE_PARAM } from "@louez/api/platform/links";

/**
 * Dashboard links that name their store (`/dashboard/…?store=<id>`, built by
 * the API's link helpers for agents and the in-app assistant). The proxy
 * hands such a request to the active-store route, which switches the store
 * when the user may open it, then sends the browser to the same URL without
 * the parameter, so it never stays in the history or in a shared link.
 */

/** The route that switches the active store, then redirects. */
export const ACTIVE_STORE_ROUTE = "/api/active-store";
/** Its parameter holding the dashboard URL to go back to. */
export const ACTIVE_STORE_NEXT_PARAM = "next";

// Next.js marks its own data requests with this; it is not part of the page URL.
const FLIGHT_PARAM = "_rsc";

const DEFAULT_PATH = "/dashboard";

const isDashboardPathname = (pathname: string) =>
  pathname === DEFAULT_PATH || pathname.startsWith(`${DEFAULT_PATH}/`);

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
 * The dashboard path to go back to: a relative path under `/dashboard` with
 * no `store` parameter, or `/dashboard`. Anything else (another origin,
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
