import { PARTNER_ATTRIBUTION_DAYS, parsePartnerCode } from "@louez/api/contracts/partners";

/**
 * The storefront cookie that remembers which partner a customer agreed to
 * credit (docs/product/liens-partenaires.md). Set only when the customer says
 * yes on the partner link's prompt: an affiliation tracker needs consent.
 * httpOnly, read by the checkout and `/api/track` on the server. Its value
 * names the store too, so a browser that visits two stores on one host (a
 * local preview) never credits one store's partner on the other.
 */
export const PARTNER_COOKIE = "louez_partner";

export const PARTNER_COOKIE_MAX_AGE = PARTNER_ATTRIBUTION_DAYS * 24 * 60 * 60;

export const encodePartnerCookie = (storeId: string, code: string): string => `${storeId}.${code}`;

/** The partner code the cookie holds for this store, or null. */
export const partnerCodeFromCookie = (
  value: string | undefined,
  storeId: string,
): string | null => {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator <= 0 || value.slice(0, separator) !== storeId) return null;
  return parsePartnerCode(value.slice(separator + 1));
};
