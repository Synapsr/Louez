import { type PolicyInvoicing, isBillingSyncEnabled } from "@louez/db";
import type { MemberRole } from "@louez/utils";

import { type EffectivePolicy, getEffectivePolicy } from "@/lib/billing/policy";

// Who sees the billing pages of the active store, and as whom: the "Facturation"
// entry, its pages and their actions follow this one rule (louez-billing docs/api,
// README §10).

/** An owner sees and changes the billing pages; a platform admin only sees them. */
export type BillingViewerRole = "owner" | "platform_admin";

/**
 * The store's owner, when the service bills the store (`invoicing: service`), as
 * `owner`; a platform admin, on any store, as `platform_admin`, read-only. Nobody
 * else, so while every store is legacy, only platform admins see them.
 */
export function billingViewerRole(input: {
  readonly memberRole: MemberRole;
  readonly isPlatformAdmin: boolean;
  readonly invoicing: PolicyInvoicing;
}): BillingViewerRole | null {
  if (input.memberRole === "owner" && input.invoicing === "service") return "owner";
  if (input.isPlatformAdmin) return "platform_admin";
  return null;
}

export type BillingAccess = {
  readonly role: BillingViewerRole;
  /** The store's policy now, from the cache: what the settings card shows. */
  readonly policy: EffectivePolicy;
};

/**
 * The viewer's access to the billing pages of `store`, the server-side active store, or
 * null. Only in service mode (README §12): elsewhere it reads nothing.
 */
export async function getBillingAccess(
  store: { readonly id: string; readonly role: MemberRole },
  isPlatformAdmin: boolean,
  now: Date = new Date(),
): Promise<BillingAccess | null> {
  if (!isBillingSyncEnabled()) return null;
  const policy = await getEffectivePolicy(store.id, now);
  const role = billingViewerRole({
    memberRole: store.role,
    isPlatformAdmin,
    invoicing: policy.terms.invoicing,
  });
  return role ? { role, policy } : null;
}
