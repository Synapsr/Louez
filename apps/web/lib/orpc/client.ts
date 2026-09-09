import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppRouter } from "@louez/api";
import type { RouterClient } from "@orpc/server";
import { getPublicEnvSnapshot } from "@/components/shared/public-env-provider";
import { getStorefrontSlugFromHost } from "@/lib/util.host";

/**
 * Store slug set by the StoreProvider during render. It is the authority on
 * which store the page belongs to: the server resolved it, whatever the host
 * (subdomain, dashboard `/{slug}` path, PREVIEW_STORE_SLUG rewrite).
 */
let storefrontSlug: string | null = null;

export const setStorefrontSlug = (slug: string) => {
  storefrontSlug = slug;
};

/**
 * Store slug of the current host, for calls made before a StoreProvider
 * rendered. Same host rule as the proxy and the server link prefix.
 */
const getStoreSlugFromHost = (): string | null => {
  if (typeof window === "undefined") return null;

  const publicEnv = getPublicEnvSnapshot();
  return getStorefrontSlugFromHost(window.location.hostname, {
    appDomain: publicEnv.NEXT_PUBLIC_APP_DOMAIN,
    dashboardSubdomain: publicEnv.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN,
  });
};

/**
 * RPC Link configuration for client-server communication
 */
const getRpcUrl = (): string => {
  if (typeof window !== "undefined") {
    return new URL("/api/rpc", window.location.origin).toString();
  }

  return new URL("/api/rpc", getPublicEnvSnapshot().NEXT_PUBLIC_APP_URL).toString();
};

const link = new RPCLink({
  // Resolve lazily: PublicEnvProvider installs the validated runtime config
  // before any child query can execute.
  url: getRpcUrl,
  headers: () => {
    // Store header for storefront procedures: the provider's slug first, the
    // host as a fallback for calls issued outside a StoreProvider.
    const storeSlug = storefrontSlug ?? getStoreSlugFromHost();
    return storeSlug ? { "x-store-slug": storeSlug } : {};
  },
  fetch: (input, init) => {
    // Use native fetch with credentials for cookie-based auth
    return globalThis.fetch(input, {
      ...init,
      credentials: "include",
    });
  },
});

/**
 * Type-safe oRPC client for making API calls
 *
 * Usage:
 * ```ts
 * // Direct call
 * const result = await orpcClient.dashboard.ping({ message: 'hello' })
 *
 * // With TanStack Query (see react.ts)
 * const { data } = useQuery(orpc.dashboard.ping.queryOptions({ input: { message: 'hello' } }))
 * ```
 */
export const orpcClient: RouterClient<AppRouter> = createORPCClient(link);
