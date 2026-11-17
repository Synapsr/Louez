import { db, stores } from "@louez/db";
import { eq } from "drizzle-orm";

import { planOfferErrors, type PlanOfferView } from "../contracts/billing";
import { analyticsEventIdentity, enqueueEffects } from "../platform/effects";
import type { ApiPorts } from "../platform/ports";

/**
 * The dashboard's offer of a Louez plan to a store a plan would have cost less
 * (docs/domain/plan-offer.md). The rule and the figures are the app's billing code
 * (`ports.billing.planOffer`); this records what a member does with the card.
 */

type Ports = Pick<ApiPorts, "billing" | "dispatchEffects">;

/** The offer the store's dashboard shows now, or null. */
export async function getPlanOffer(input: {
  storeId: string;
  ports: Ports;
  now?: Date;
}): Promise<PlanOfferView | null> {
  const read = input.ports.billing?.planOffer;
  if (!read) return null;
  return read({ storeId: input.storeId, now: input.now ?? new Date() });
}

/** Counts the card as seen by the member, with the figures it showed them. */
export async function recordPlanOfferShown(input: {
  storeId: string;
  userId: string;
  offer: PlanOfferView;
  ports: Ports;
}): Promise<void> {
  await input.ports.billing?.recordPlanOfferShown?.({
    storeId: input.storeId,
    userId: input.userId,
    offer: input.offer,
  });
}

/**
 * Closes the card for the whole store (it is the owner's decision), for 30 days from
 * now. The offer it closed, if any, is the dismissed event's figures.
 */
export async function dismissPlanOffer(input: {
  storeId: string;
  userId: string;
  ports: Ports;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const offer = await getPlanOffer({ ...input, now });
  const effectIds = await db.transaction(async (tx) => {
    await tx.update(stores).set({ planOfferDismissedAt: now }).where(eq(stores.id, input.storeId));
    if (!offer) return [];
    return enqueueEffects(tx, input.storeId, [
      {
        type: "billing.planOfferAnalytics",
        payload: {
          ...analyticsEventIdentity(now),
          event: "plan_offer_dismissed",
          userId: input.userId,
          storeId: input.storeId,
          offer,
        },
      },
    ]);
  });
  input.ports.dispatchEffects(effectIds);
}

/**
 * The offered plan's Stripe Checkout: opened only while the offer still applies, so
 * a store that took a plan or got a coupon since is refused.
 */
export async function startPlanOffer(input: {
  storeId: string;
  userId: string;
  affiliateReferral: string | null;
  ports: Ports;
  now?: Date;
}): Promise<{ url: string }> {
  const now = input.now ?? new Date();
  const start = input.ports.billing?.startPlanOfferCheckout;
  const started = start
    ? await start({ storeId: input.storeId, affiliateReferral: input.affiliateReferral, now })
    : null;
  if (!started) throw planOfferErrors.unavailable();

  const effectIds = await db.transaction((tx) =>
    enqueueEffects(tx, input.storeId, [
      {
        type: "billing.planOfferAnalytics",
        payload: {
          ...analyticsEventIdentity(now),
          event: "plan_offer_clicked",
          userId: input.userId,
          storeId: input.storeId,
          offer: started.offer,
        },
      },
    ]),
  );
  input.ports.dispatchEffects(effectIds);
  return { url: started.url };
}
