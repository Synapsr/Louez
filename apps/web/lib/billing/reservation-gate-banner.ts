import type { MemberRole } from "@louez/utils";

import type { EffectivePolicy } from "./policy";

// What the dashboard shows about the card gate (louez-billing docs/api, README §8.4;
// design §4.7): a banner from the policy's `notice` and `labels.notice`, and a dialog
// when a refused action is tried. Louez keeps only generic text (design §6.4): the
// service's label, when there is one, is the only specific wording.

/** A policy label: plain text in `fr`, `en` and maybe other languages (README §8.4). */
export type PolicyLabel = { readonly en: string; readonly [language: string]: string };

/** The label in `locale` when the service sent one, otherwise English. Rendered as text. */
export function policyLabel(text: PolicyLabel, locale: string): string {
  return text[locale] ?? text.en;
}

export type ReservationGateBanner = {
  /** `paused`: the gate refuses new reservations now. `notice`: a notice without a block yet. */
  readonly kind: "paused" | "notice";
  /** `labels.notice` in the reader's language, or null for Louez's generic text. */
  readonly label: string | null;
};

/** The banner of a store's effective policy, or null when there is nothing to say. */
export function reservationGateBanner(
  effective: Pick<EffectivePolicy, "acceptsReservations" | "policy">,
  locale: string,
): ReservationGateBanner | null {
  const notice = effective.policy?.labels.notice ?? null;
  const label = notice ? policyLabel(notice, locale) : null;
  if (!effective.acceptsReservations) return { kind: "paused", label };
  if (effective.policy?.notice) return { kind: "notice", label };
  return null;
}

/** Who may open the billing pages: the owner or a platform admin (README §10). */
export function canManageBilling(role: MemberRole | undefined): boolean {
  return role === "owner" || role === "platform_admin";
}
