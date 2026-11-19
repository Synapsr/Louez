import {
  MAX_PARTNER_ATTRIBUTION_DAYS,
  PARTNER_LINK_PARAM,
  parsePartnerCode,
} from "@louez/api/contracts/partner-code";

/**
 * The storefront cookie of Liens partenaires (docs/product/liens-partenaires.md):
 * the last partner link a visitor followed, set by the proxy on any storefront
 * page opened with `?partner=<code>`, and read on the server by the checkout and
 * `/api/track`. httpOnly, on the store's host. It names the store and the time
 * of the click, so a browser that visits two stores on one host (a local
 * preview) never credits one store's partner on the other, and each store's
 * attribution window is checked at the booking. No import beyond the code's
 * rules: the proxy reads it.
 */
export const PARTNER_COOKIE = "louez_partner";

/** As long as the longest window a store may choose. */
export const PARTNER_COOKIE_MAX_AGE = MAX_PARTNER_ATTRIBUTION_DAYS * 24 * 60 * 60;

export { PARTNER_LINK_PARAM };

/** `<store slug>.<code>.<click time, in seconds>`. */
export const encodePartnerCookie = (storeSlug: string, code: string, clickedAt: Date): string =>
  `${storeSlug}.${code}.${Math.floor(clickedAt.getTime() / 1000)}`;

/** The partner code and click time the cookie holds for this store, or null. */
export const readPartnerCookie = (
  value: string | undefined | null,
  storeSlug: string,
): { code: string; clickedAt: Date } | null => {
  const parts = value?.split(".") ?? [];
  if (parts.length !== 3 || parts[0] !== storeSlug) return null;
  const code = parsePartnerCode(parts[1]);
  const seconds = Number(parts[2]);
  if (!code || !Number.isSafeInteger(seconds) || seconds <= 0) return null;
  return { code, clickedAt: new Date(seconds * 1000) };
};
