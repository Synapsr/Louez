// A partner's own space (Liens partenaires), opened by its secret link
// without an account. No import: the proxy reads it on every request.

const PREFIX = "/partner/";

/** The partner's space, on the dashboard's address. */
export function partnerSpaceUrl(appUrl: string, token: string): string {
  return `${new URL(appUrl).origin}${PREFIX}${token}`;
}

/** The pages and routes that answer it: `/partner/<token>`. */
export const isPartnerSpacePath = (pathname: string): boolean => pathname.startsWith(PREFIX);
