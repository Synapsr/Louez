import { notFound, redirect } from "next/navigation";

import { billingPageHref } from "./billing-pages";
import { isBillingEnabled } from "./mode";
import { legacyBillingApplies } from "./policy";

/** For a page that exists only for platform billing: 404 when LOUEZ_BILLING is off. */
export function requirePlatformBilling(): void {
  if (!isBillingEnabled()) notFound();
}

/**
 * For a page of Louez's own legacy billing (referral rewards): 404 when LOUEZ_BILLING is
 * off, and the billing pages instead for a store the billing service bills, which
 * Louez's legacy code does not bill (README §8.3). Plans are sold to every store (§8.7).
 */
export async function requireLegacyBilling(storeId: string): Promise<void> {
  requirePlatformBilling();
  if (!(await legacyBillingApplies(storeId, new Date()))) redirect(billingPageHref("/"));
}
