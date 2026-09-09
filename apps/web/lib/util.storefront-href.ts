const isStoreRelative = (href: string): boolean => href.startsWith("/") && !href.startsWith("//");

/**
 * Prefixes a store-relative href with the storefront `basePath` (`""` on a
 * store subdomain or standalone origin, `/{slug}` on the dashboard host).
 * External URLs, anchors and already-prefixed paths pass through, so links
 * and `router.push` calls agree wherever the prefix comes from.
 */
export const resolveStorefrontHref = (basePath: string, href: string): string => {
  if (!basePath || !isStoreRelative(href)) {
    return href;
  }

  if (href === basePath || href.startsWith(`${basePath}/`) || href.startsWith(`${basePath}?`)) {
    return href;
  }

  return `${basePath}${href}`;
};
