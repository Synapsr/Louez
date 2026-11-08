import type { UrlsPort } from "@louez/api";

import { getStorefrontUrl } from "@/lib/storefront-url";

import { env } from "@/env";

/**
 * This deployment's addresses, lent to the agent-ready API as `ports.urls`.
 * The dashboard is on the app URL; the storefront goes through the one
 * storefront builder, so subdomains, local path routing and standalone mode
 * match the app's other links. A preview deployment builds its own URLs.
 */
export const apiUrls: UrlsPort = {
  dashboard: (path) => {
    const origin = (env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
    return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
  },
  storefront: (storeSlug, path) => getStorefrontUrl(storeSlug, path),
};
