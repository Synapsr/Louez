/**
 * Liens partenaires (docs/product/liens-partenaires.md): what a partner's link
 * carries and how long it holds. No import: the storefront proxy reads it on
 * every request.
 */

/** The query parameter of a partner link: `https://<store>/?partner=les-pins`. */
export const PARTNER_LINK_PARAM = "partner";

/** Lowercase letters, digits and inner dashes, 2 to 40 characters. */
export const PARTNER_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/;

/** How long a store may let a partner link hold, in days, from the click to the booking. */
export const PARTNER_ATTRIBUTION_DAY_OPTIONS = [7, 14, 30, 60, 90] as const;
export type PartnerAttributionDays = (typeof PARTNER_ATTRIBUTION_DAY_OPTIONS)[number];
export const DEFAULT_PARTNER_ATTRIBUTION_DAYS: PartnerAttributionDays = 30;
/** The cookie lives as long as the longest window; each store's window is checked at the booking. */
export const MAX_PARTNER_ATTRIBUTION_DAYS = 90;

/** The store's window, or the default for a value that is not one of the options. */
export function partnerAttributionDays(value: unknown): PartnerAttributionDays {
  return (
    PARTNER_ATTRIBUTION_DAY_OPTIONS.find((days) => days === value) ??
    DEFAULT_PARTNER_ATTRIBUTION_DAYS
  );
}

/** The code a link (or a customer at checkout) names, or null for anything that cannot be a code. */
export function parsePartnerCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return PARTNER_CODE_PATTERN.test(code) ? code : null;
}

/**
 * A code drawn from the partner's name, accents and punctuation dropped:
 * "Camping Les Pins" gives `camping-les-pins`. Null when nothing is left.
 */
export function partnerCodeFromName(name: string): string | null {
  const code = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34)
    .replace(/-+$/g, "");
  return parsePartnerCode(code);
}
