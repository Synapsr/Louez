import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppRouter } from "@louez/api";
import type { RouterClient } from "@orpc/server";
import { getPublicEnvSnapshot } from "@/components/shared/public-env-provider";
import { AFFILIATE_REFERRAL_HEADER } from "@/lib/acquisition/klibon";
import { readAffiliateReferral } from "@/lib/acquisition/klibon-browser";
import { getStorefrontSlugFromHost } from "@/lib/util.host";

import { rpcCsrfLinkPlugin } from "./csrf";

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

const ONBOARDING_STORE_STEP = new Set(["create", "updateOnboardingInfo"]);

const isOnboardingStoreStep = (path: readonly string[]) =>
  path.length === 3 &&
  path[0] === "dashboard" &&
  path[1] === "stores" &&
  ONBOARDING_STORE_STEP.has(path[2] ?? "");

/**
 * RPC Link configuration for client-server communication
 */
const getRpcUrl = (): string => {
  if (typeof window !== "undefined") {
    return new URL("/api/rpc", window.location.origin).toString();
  }

  return new URL("/api/rpc", getPublicEnvSnapshot().NEXT_PUBLIC_APP_URL).toString();
};

/**
 * The header by which a call names its store (`STORE_HEADER`,
 * `@louez/api/platform/procedures`): the API checks the session is a member of
 * it, and reads that store instead of the session's active one.
 */
const STORE_HEADER = "louez-store";

const rpcLink = (storeId?: string) =>
  new RPCLink({
    // The header `/api/rpc` requires of every call (./csrf.ts).
    plugins: [rpcCsrfLinkPlugin()],
    // Resolve lazily: PublicEnvProvider installs the validated runtime config
    // before any child query can execute.
    url: getRpcUrl,
    headers: (_options, path) => {
      const headers: Record<string, string> = {};
      if (storeId) headers[STORE_HEADER] = storeId;
      // Store header for storefront procedures: the provider's slug first, the
      // host as a fallback for calls issued outside a StoreProvider.
      const storeSlug = storefrontSlug ?? getStoreSlugFromHost();
      if (storeSlug) headers["x-store-slug"] = storeSlug;
      // The onboarding's store step: the Klibon affiliate who sent the visitor, if any.
      if (typeof window !== "undefined" && isOnboardingStoreStep(path)) {
        const affiliateReferral = readAffiliateReferral();
        if (affiliateReferral) headers[AFFILIATE_REFERRAL_HEADER] = affiliateReferral;
      }
      return headers;
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
export const orpcClient: RouterClient<AppRouter> = createORPCClient(rpcLink());

const storeClients = new Map<string, RouterClient<AppRouter>>();

/**
 * The client whose calls name their store: for what a page keeps showing after
 * the session's active store changed in another tab. Such a call answers for
 * the store the page was rendered for, or is refused, never for another one.
 * Only procedures that select their store through the API platform
 * (`storeProcedure`) read the header.
 */
export const orpcClientForStore = (storeId: string): RouterClient<AppRouter> => {
  let client = storeClients.get(storeId);
  if (!client) {
    client = createORPCClient(rpcLink(storeId));
    storeClients.set(storeId, client);
  }
  return client;
};
