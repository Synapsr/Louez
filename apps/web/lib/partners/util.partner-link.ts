import { PARTNER_LINK_PARAM } from "@louez/api/contracts/partners";

/** The partner's link: the store's address with `?partner=<code>`. */
export function partnerLinkUrl(storeUrl: string, code: string): string {
  try {
    const url = new URL(storeUrl);
    url.searchParams.set(PARTNER_LINK_PARAM, code);
    return url.toString();
  } catch {
    return storeUrl;
  }
}
