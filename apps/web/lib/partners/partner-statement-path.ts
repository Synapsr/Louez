// A partner's read-only statement page (Liens partenaires). No import: the
// proxy reads it on every request.

const PREFIX = "/partner-statements/";

/** The partner's statement page, on the dashboard's address. */
export function partnerStatementUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, "")}${PREFIX}${token}`;
}

/** The page that answers it: `/partner-statements/<token>`. */
export const isPartnerStatementPath = (pathname: string): boolean => pathname.startsWith(PREFIX);
