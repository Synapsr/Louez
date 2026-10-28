import type { PolicyReservations } from "@louez/db";

import type { BillingHandoffAccess } from "@/lib/billing/handoff-access";

// What the billing settings card shows, from the cached policy (louez-billing
// docs/plans/design.md §6.1; docs/api README §8.4): the offer label, whether the store
// takes reservations, the service's notice, and the billing page to open first.

type LocalizedText = Readonly<Record<string, string>> & { readonly en: string };

export type BlockedReason = Extract<PolicyReservations, { allowed: false }>["reason"];

export type BillingOverview = {
  /** The service's words for the offer; null before the store has a policy. */
  readonly offer: string | null;
  /** The service's notice, such as a block to come; null when there is none. */
  readonly notice: string | null;
  /** Why the card gate refuses billable reservations now, or null when it does not. */
  readonly blockedReason: BlockedReason | null;
  /** A platform admin's session on the billing pages is read-only. */
  readonly readOnly: boolean;
  /** The billing page of the main button: the card page when the owner has no card. */
  readonly primaryPage: "/" | "/payment-method";
};

/**
 * A label in the user's language if the service sent it, otherwise English (README
 * §8.4). React renders it as text, never as HTML.
 */
export function localizedLabel(text: LocalizedText, locale: string): string {
  return text[locale] ?? text.en;
}

export function describeBillingOverview(
  access: BillingHandoffAccess,
  locale: string,
): BillingOverview {
  const { policy, terms, acceptsReservations } = access.policy;
  const blockedReason =
    !acceptsReservations && !terms.reservations.allowed ? terms.reservations.reason : null;
  const notice = policy?.labels.notice;
  const readOnly = access.role === "platform_admin";
  return {
    offer: policy ? localizedLabel(policy.labels.offer, locale) : null,
    notice: notice ? localizedLabel(notice, locale) : null,
    blockedReason,
    readOnly,
    // A read-only session cannot add a card, so it opens the overview.
    primaryPage: !readOnly && blockedReason === "payment_method_required" ? "/payment-method" : "/",
  };
}
