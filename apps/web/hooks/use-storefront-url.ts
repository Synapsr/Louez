"use client";

import { useCallback, useSyncExternalStore } from "react";

import { useInstanceConfig } from "@/components/instance-provider";
import { usePublicEnv } from "@/components/shared/public-env-provider";
import { useStorefrontBasePath } from "@/contexts/store-context";
import { buildStorefrontUrl } from "@/lib/util.storefront-url";

const subscribeToOrigin = () => () => undefined;
const getBrowserOrigin = () => window.location.origin;
const getServerOrigin = () => "";

interface AbsoluteStorefrontUrlOptions {
  domain?: string;
  origin: string;
  path?: string;
  standalone: boolean;
  storeSlug: string;
}

/**
 * Absolute storefront URL as seen from the browser. Thin adapter over the
 * shared builder: the store subdomain is always https, and both standalone
 * and local platform forms build on the current origin.
 */
export const buildAbsoluteStorefrontUrl = ({
  domain,
  origin,
  path = "/",
  standalone,
  storeSlug,
}: AbsoluteStorefrontUrlOptions): string =>
  buildStorefrontUrl({
    slug: storeSlug,
    path,
    standalone,
    appDomain: domain,
    origin,
    protocol: "https",
  });

/**
 * Hook to generate correct storefront URLs based on the routing context.
 *
 * Relative links take the prefix the server computed for this host
 * (`StoreProvider.basePath`): nothing on the store subdomain, in standalone
 * and in local preview mode, where the proxy injects the slug; `/{slug}` on
 * the dashboard host, which serves the same pages under `/{slug}`. Outside
 * the storefront tree (dashboard components) the prefix is unknown and links
 * keep the slug, which is what every dashboard host needs.
 */
export const useStorefrontUrl = (storeSlug: string) => {
  const { standalone } = useInstanceConfig();
  const { NEXT_PUBLIC_APP_DOMAIN: appDomain } = usePublicEnv();
  const serverBasePath = useStorefrontBasePath();
  // React uses getServerOrigin() for both SSR and the first hydration pass,
  // then refreshes to window.location.origin. Reading window during render
  // made the server emit relative URLs while the client emitted absolute
  // ones, regenerating the dashboard tree on every load in standalone mode.
  const origin = useSyncExternalStore(subscribeToOrigin, getBrowserOrigin, getServerOrigin);

  const basePath = serverBasePath ?? (standalone ? "" : `/${storeSlug}`);
  const isSubdomain = !standalone && basePath === "";

  /**
   * Generate a storefront URL path.
   * Returns path without slug on subdomains, with slug otherwise.
   */
  const getUrl = useCallback(
    (path: string) => {
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return `${basePath}${normalizedPath}`;
    },
    [basePath],
  );

  /**
   * Absolute storefront URL for sharing/preview surfaces (copy buttons,
   * target=_blank links). Standalone: the current origin, no slug. Platform:
   * the store subdomain — or a path on the current origin during
   * localhost development, where subdomains do not resolve.
   */
  const getAbsoluteUrl = useCallback(
    (path: string = "/") =>
      buildAbsoluteStorefrontUrl({
        domain: appDomain,
        origin,
        path,
        standalone,
        storeSlug,
      }),
    [appDomain, origin, standalone, storeSlug],
  );

  return { getUrl, getAbsoluteUrl, isSubdomain };
};
