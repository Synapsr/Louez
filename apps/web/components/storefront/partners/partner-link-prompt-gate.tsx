import { headers } from "next/headers";

import { PARTNER_LINK_PARAM, parsePartnerCode } from "@louez/api/contracts/partners";
import { findActivePartnerByCode } from "@louez/api/services/partners";

import { PartnerLinkPrompt } from "./partner-link-prompt";

interface PartnerLinkPromptGateProps {
  storeId: string;
}

/**
 * A storefront page opened by a partner's link (`?partner=<code>`): the
 * customer is asked whether to credit that partner. The proxy passes the
 * page's path and query (`x-storefront-path`); nothing for an unknown or
 * archived code, or a page without one.
 */
export const PartnerLinkPromptGate = async ({ storeId }: PartnerLinkPromptGateProps) => {
  const path = (await headers()).get("x-storefront-path") ?? "";
  const query = path.includes("?") ? path.slice(path.indexOf("?")) : "";
  const code = parsePartnerCode(new URLSearchParams(query).get(PARTNER_LINK_PARAM));
  if (!code) return null;
  const partner = await findActivePartnerByCode(storeId, code);
  if (!partner) return null;
  return <PartnerLinkPrompt storeId={storeId} code={code} partnerName={partner.name} />;
};
