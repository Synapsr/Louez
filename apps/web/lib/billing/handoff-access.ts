import { type PolicyInvoicing, isBillingSyncEnabled } from "@louez/db";
import type { MemberRole } from "@louez/utils";

import type { HandoffRole } from "@/lib/billing/handoff";
import { type EffectivePolicy, getEffectivePolicy } from "@/lib/billing/policy";

// Who opens the billing service's pages for the active store, and as whom: the
// "Facturation" entry, its settings page and the hand-off follow this one rule.

/**
 * README §10 step 1, narrowed by the M2 plan's D4: the store's owner, when the service
 * bills the store (`invoicing: service`), opens them as `owner`; a platform admin, on
 * any store, as `platform_admin`, read-only. Nobody else, so in production during M2,
 * where every store is legacy, only platform admins see them.
 */
export function billingHandoffRole(input: {
  readonly memberRole: MemberRole;
  readonly isPlatformAdmin: boolean;
  readonly invoicing: PolicyInvoicing;
}): HandoffRole | null {
  if (input.memberRole === "owner" && input.invoicing === "service") return "owner";
  if (input.isPlatformAdmin) return "platform_admin";
  return null;
}

/** Who is signed in on the hand-off and its return; the email is for the admin check. */
export type BillingSession = {
  readonly userId: string;
  readonly email: string | null;
};

export type BillingHandoffAccess = {
  readonly role: HandoffRole;
  /** The store's policy now, from the cache: what the settings card shows. */
  readonly policy: EffectivePolicy;
};

/**
 * The viewer's access to the billing pages of `store`, the server-side active store, or
 * null. Only in service mode (README §12): elsewhere it reads nothing.
 */
export async function getBillingHandoffAccess(
  store: { readonly id: string; readonly role: MemberRole },
  isPlatformAdmin: boolean,
  now: Date = new Date(),
): Promise<BillingHandoffAccess | null> {
  if (!isBillingSyncEnabled()) return null;
  const policy = await getEffectivePolicy(store.id, now);
  const role = billingHandoffRole({
    memberRole: store.role,
    isPlatformAdmin,
    invoicing: policy.terms.invoicing,
  });
  return role ? { role, policy } : null;
}
