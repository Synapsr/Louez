/**
 * Where the test-mode link (`/{slug}/test-mode`, lib/test-reservations) sends the
 * visitor, and the path its cookie lives on. Pure, for the route.
 */
export interface TestModeRoutePaths {
  /** The store's home on the host the visitor typed: always same-origin. */
  home: string;
  /** The storefront's own path, where the test-mode cookie lives. */
  cookiePath: string;
}

/**
 * The paths of a store found in the database (`storeSlug`, never the URL's
 * decoded segment), served at the host's root (`slugless`: its own subdomain,
 * standalone, local preview) or under `/{slug}`. The slug is encoded as one path
 * segment, so the redirect is never protocol-relative (`//other.host/`); no store
 * lands on `/`.
 */
export function testModeRoutePaths(
  storeSlug: string | null | undefined,
  slugless: boolean,
): TestModeRoutePaths {
  if (!storeSlug || slugless) return { home: "/", cookiePath: "/" };
  const segment = `/${encodeURIComponent(storeSlug)}`;
  return { home: `${segment}/`, cookiePath: segment };
}
