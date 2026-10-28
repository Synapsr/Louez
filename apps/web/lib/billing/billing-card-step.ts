import type { PostHog } from "posthog-node";

import { isBillingSyncEnabled } from "@louez/db";
import type { MemberRole } from "@louez/utils";

import { env } from "@/env";
import type { HandoffRole } from "@/lib/billing/handoff";
import { billingHandoffRole, getBillingHandoffAccess } from "@/lib/billing/handoff-access";
import { type EffectivePolicy, getUncreatedStorePolicy } from "@/lib/billing/policy";
import { log } from "@/lib/evlog";
import { getPostHogServer } from "@/lib/posthog";

// The onboarding's "Billing card" step (louez-billing docs/plans/design.md §4.7; M2
// plan L6): after the payment step, it sends the owner of a store the billing service
// bills, and whose policy asks for a card, through the hand-off to `/payment-method`
// and back. Nobody sees it with LOUEZ_BILLING off, without the service, on a legacy
// store, with BILLING_GATE_DISABLED, or while its PostHog flag is not on.

/** The PostHog flag of the step, evaluated for the signed-in user. */
export const BILLING_CARD_STEP_FLAG = "onboarding-billing-card";

/** What evaluates the flag: PostHog's project key, and the client that asks PostHog. */
export type BillingCardFlagSource = {
  readonly apiKey: string | undefined;
  readonly client: () => Pick<PostHog, "isFeatureEnabled">;
};

const posthogFlags = (): BillingCardFlagSource => ({
  apiKey: env.NEXT_PUBLIC_POSTHOG_KEY,
  client: getPostHogServer,
});

/**
 * The flag, failing closed: the step shows only on an explicit true. No PostHog key,
 * an unknown flag (null or undefined) or a failed evaluation hide it. The opposite of
 * lib/invoicing/feature.ts, which fails open.
 */
export async function isBillingCardStepFlagOn(
  userId: string,
  source: BillingCardFlagSource = posthogFlags(),
): Promise<boolean> {
  if (!source.apiKey) return false;
  try {
    return (await source.client().isFeatureEnabled(BILLING_CARD_STEP_FLAG, userId)) === true;
  } catch (error) {
    log.error(
      "billing",
      `the ${BILLING_CARD_STEP_FLAG} flag failed for user ${userId}, so the step is hidden: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/**
 * Whether the policy asks the viewer for a card: they open the billing pages as the
 * owner, which only a store the service bills allows (`billingHandoffRole`), and the
 * card gate refuses reservations until a card is on file. The same rule sends the
 * billing settings' main button to the card page (billing-overview.ts). With
 * BILLING_GATE_DISABLED the gate lets reservations through, and the banners and the
 * settings show no block and no card notice: the step does not claim one either.
 */
export function asksForBillingCard(role: HandoffRole | null, policy: EffectivePolicy): boolean {
  const { reservations } = policy.terms;
  return (
    role === "owner" &&
    !policy.acceptsReservations &&
    !reservations.allowed &&
    reservations.reason === "payment_method_required"
  );
}

/** A store the step may be for, with the viewer's role in it. */
export type BillingCardStepStore = { readonly id: string; readonly role: MemberRole };

/**
 * The stores the onboarding's step list asks about, from the active store. A draft is
 * the store the flow onboards. A completed one is either the flow's own store, on the
 * steps after the payment step (which completes it), or an earlier store while a new
 * one is on the way: both count, so the list has the step whenever the step page,
 * which decides for the active store, can show it. Null stands for a store created
 * now, which its creator owns.
 */
export function onboardingBillingCardStores(
  active: (BillingCardStepStore & { readonly onboardingCompleted: boolean | null }) | null,
): ReadonlyArray<BillingCardStepStore | null> {
  if (!active) return [null];
  const store = { id: active.id, role: active.role };
  return active.onboardingCompleted ? [store, null] : [store];
}

export type BillingCardStepViewer = {
  readonly userId: string;
  readonly isPlatformAdmin: boolean;
  /**
   * The stores the step may be for (null for the store the onboarding has not created
   * yet, which its creator will own): it shows when one of them asks for a card.
   */
  readonly stores: ReadonlyArray<BillingCardStepStore | null>;
  readonly now?: Date;
  readonly flags?: BillingCardFlagSource;
};

async function storeAsksForBillingCard(
  store: BillingCardStepStore | null,
  isPlatformAdmin: boolean,
  now: Date,
): Promise<boolean> {
  if (store) {
    const access = await getBillingHandoffAccess(store, isPlatformAdmin, now);
    return access !== null && asksForBillingCard(access.role, access.policy);
  }
  const policy = await getUncreatedStorePolicy(now);
  const role = billingHandoffRole({
    memberRole: "owner",
    isPlatformAdmin,
    invoicing: policy.terms.invoicing,
  });
  return asksForBillingCard(role, policy);
}

/** Whether the onboarding shows the "Billing card" step. The flag is asked last, once. */
export async function showsBillingCardStep(viewer: BillingCardStepViewer): Promise<boolean> {
  if (!isBillingSyncEnabled()) return false;
  const now = viewer.now ?? new Date();
  let asks = false;
  for (const store of viewer.stores) {
    if (await storeAsksForBillingCard(store, viewer.isPlatformAdmin, now)) {
      asks = true;
      break;
    }
  }
  if (!asks) return false;
  return isBillingCardStepFlagOn(viewer.userId, viewer.flags);
}
