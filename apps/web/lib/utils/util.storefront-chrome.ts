/**
 * How the storefront chrome (header, footer) dresses for a route.
 *
 * - `transparent`: the home page, where the header sits over the hero.
 * - `compact`: checkout, where the chrome steps back (logo, lock,
 *   legal links) so the form is the only thing on screen.
 * - `account`: reservations and account pages.
 * - `default`: login and other storefront pages.
 */
export type StorefrontChromeVariant = "default" | "transparent" | "compact" | "account";

const COMPACT_PATHS = ["/checkout"] as const;

const stripPrefix = (pathname: string, prefix: string): string => {
  if (!prefix || prefix === "/") {
    return pathname;
  }

  if (pathname === prefix) {
    return "/";
  }

  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
};

const stripTrailingSlash = (pathname: string): string =>
  pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

export interface StorefrontChromeLocation {
  /** Storefront prefix on the current host: `""` on a subdomain, `/{slug}` on the dashboard host. */
  basePath?: string;
  /**
   * The proxy rewrites every storefront request onto `/{slug}/...`, and on
   * the server `usePathname` reports that internal path while the browser
   * reports the public one. Both forms map to the same variant.
   */
  storeSlug?: string;
}

/**
 * The route as the store sees it (`/`, `/catalog`, `/checkout`), with the
 * host prefix and the proxy slug removed. Chrome that reacts to one page in
 * particular compares against this, never against the raw pathname.
 */
export const getStorefrontStorePath = (
  pathname: string,
  { basePath = "", storeSlug = "" }: StorefrontChromeLocation = {},
): string => {
  const withoutBasePath = stripPrefix(pathname, basePath);

  return stripTrailingSlash(
    storeSlug ? stripPrefix(withoutBasePath, `/${storeSlug}`) : withoutBasePath,
  );
};

/** Variant for a pathname, whichever host or render side produced it. */
export const getStorefrontChromeVariant = (
  pathname: string,
  location: StorefrontChromeLocation = {},
): StorefrontChromeVariant => {
  const storePath = getStorefrontStorePath(pathname, location);

  if (storePath === "/") {
    return "transparent";
  }

  if (COMPACT_PATHS.some((path) => storePath === path || storePath.startsWith(`${path}/`))) {
    return "compact";
  }

  if (
    storePath === "/account" ||
    (storePath.startsWith("/account/") &&
      storePath !== "/account/login" &&
      !storePath.startsWith("/account/login/"))
  ) {
    return "account";
  }

  return "default";
};

/**
 * One or two capital letters for the account button: first letters of the
 * first and last name, the first two letters of a single name, or the
 * first letter of the email when there is no name at all.
 */
export const getCustomerInitials = (customer: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string => {
  const first = customer.firstName?.trim() ?? "";
  const last = customer.lastName?.trim() ?? "";

  if (first && last) {
    return `${first[0]}${last[0]}`.toUpperCase();
  }

  const single = first || last;

  if (single) {
    return single.slice(0, 2).toUpperCase();
  }

  const email = customer.email?.trim() ?? "";

  return email ? email[0].toUpperCase() : "";
};
