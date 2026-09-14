/**
 * The one rule that turns a store slug and a path into a storefront URL.
 *
 * Three surfaces build these URLs — server redirects, emails and Stripe
 * (`storefront-url.ts`), client share links (`use-storefront-url.ts`) and SEO
 * canonicals (`seo.tsx`) — and they must agree byte for byte. Each caller
 * resolves its own environment (origin, protocol, deployment mode) and hands
 * it to this pure builder.
 */

export interface StorefrontUrlTarget {
  /** Store the URL addresses. */
  slug: string;
  /** Path on the storefront; "/" (or "") is the store root. Defaults to "/". */
  path?: string;
  /**
   * Single-store instance: the storefront is the root of `origin` and never
   * carries the slug (the proxy injects it).
   */
  standalone: boolean;
  /**
   * NEXT_PUBLIC_APP_DOMAIN. A missing or loopback domain cannot host
   * subdomains, so the URL falls back to `{origin}/{slug}` path routing.
   */
  appDomain?: string;
  /**
   * Origin the path-based forms are built on: the instance URL in standalone
   * mode, the dashboard origin for local platform development. An empty
   * origin yields a site-relative URL.
   */
  origin: string;
  /** Scheme of the `{slug}.{appDomain}` form. */
  protocol: "http" | "https";
}

/** Whether the platform domain is a local one where subdomains do not resolve. */
export const isLocalAppDomain = (appDomain: string | undefined): boolean =>
  !appDomain || appDomain.includes("localhost") || appDomain.includes("127.0.0.1");

/**
 * Path suffix appended to a store root. The root itself contributes nothing,
 * so a bare store URL has no trailing slash and callers can append to it.
 */
export const toStorefrontPathSuffix = (path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return normalizedPath === "/" ? "" : normalizedPath;
};

export const buildStorefrontUrl = ({
  slug,
  path = "/",
  standalone,
  appDomain,
  origin,
  protocol,
}: StorefrontUrlTarget): string => {
  const suffix = toStorefrontPathSuffix(path);

  if (standalone) {
    return `${origin}${suffix}` || "/";
  }

  if (isLocalAppDomain(appDomain)) {
    return `${origin}/${slug}${suffix}`;
  }

  return `${protocol}://${slug}.${appDomain}${suffix}`;
};
