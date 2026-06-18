import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db } from '@louez/db';
import { referralRewards, subscriptions } from '@louez/db';

import { priceForLocationIndex } from '@/lib/pay-as-you-go/config';
import {
  getDefaultFreeReservations,
  getDefaultPayAsYouGoConfigSnapshot,
} from '@/lib/pay-as-you-go/defaults';
import { billingMonthOf, getStoreBilling } from '@/lib/pay-as-you-go/metering';
import { stripe } from '@/lib/stripe/client';
import { getOrCreateStripeCustomer } from '@/lib/stripe/subscriptions';

import { isWithinMonthlyCap } from './cap';
import {
  computeFreeReservationClawback,
  isWithinClawbackWindow,
} from './clawback';
import { getReferralProgramConfig } from './defaults';
import { notifyReferrerRewardGranted } from './notify';
import { qualifiesForReferralReward } from './qualification';
import { computeReferrerReward } from './reward';

/** mysql2 surfaces a unique-violation as a "Duplicate entry" error — swallowed for idempotency. */
function isDuplicateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Duplicate') || message.includes('unique');
}

interface ReferredStoreRef {
  id: string;
  name: string;
  referredByStoreId: string | null;
  referredByUserId: string | null;
}

interface MaybeGrantReferrerRewardInput {
  /** The Referred Store that just took a payment (already loaded with its referredBy* fields). */
  referredStore: ReferredStoreRef;
  /** The online payment total in cents (Stripe `amount_total`). */
  qualifyingAmountCents: number;
  currency: string;
  reservationId: string;
  paymentId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  at?: Date;
}

/**
 * Qualifying Event handler: when a Referred Store takes its first online Reservation
 * payment at/above the minimum, grant its Referrer the plan-aware Referrer Reward (free
 * reservations for a pay-as-you-go referrer; an equivalent euro invoice credit for a
 * subscribed one). Idempotent — a referral pays out at most once (unique referred store).
 * Safe to call on every completed online payment; it no-ops when not applicable.
 */
export async function maybeGrantReferrerReward(
  input: MaybeGrantReferrerRewardInput,
): Promise<{ granted: boolean; reason?: string }> {
  const referrerStoreId = input.referredStore.referredByStoreId;
  if (!referrerStoreId) return { granted: false, reason: 'no_referrer' };

  const config = getReferralProgramConfig();

  if (
    !qualifiesForReferralReward({
      amountCents: input.qualifyingAmountCents,
      channel: 'online',
      minQualifyingAmountCents: config.minQualifyingAmountCents,
    })
  ) {
    return { granted: false, reason: 'below_minimum' };
  }

  // Idempotency short-circuit (the unique constraint is the real guard against races).
  const existing = await db.query.referralRewards.findFirst({
    where: eq(referralRewards.referredStoreId, input.referredStore.id),
    columns: { id: true },
  });
  if (existing) return { granted: false, reason: 'already_rewarded' };

  // Size the reward from the Referrer's own billing: free reservations valued at their
  // entry-tier pay-as-you-go price, or the equivalent euro credit if they are subscribed.
  const referrerBilling = await getStoreBilling(referrerStoreId);
  const unitValueCents = priceForLocationIndex(referrerBilling.config, 1);
  const reward = computeReferrerReward({
    billingMode:
      referrerBilling.billingMode === 'subscription'
        ? 'subscription'
        : 'pay_as_you_go',
    freeReservations: config.referrerRewardFreeReservations,
    unitValueCents,
  });

  const at = input.at ?? new Date();
  const grantedMonth = billingMonthOf(at);
  const currency = (referrerBilling.config.currency || input.currency || 'eur')
    .toLowerCase()
    .slice(0, 3);

  // Per-referrer monthly cap (0 = unlimited, the launch default).
  if (config.monthlyCapPerReferrer > 0) {
    const [{ value }] = await db
      .select({ value: sql<number>`count(*)` })
      .from(referralRewards)
      .where(
        and(
          eq(referralRewards.referrerStoreId, referrerStoreId),
          eq(referralRewards.grantedMonth, grantedMonth),
          eq(referralRewards.status, 'granted'),
        ),
      );
    if (
      !isWithinMonthlyCap({
        rewardedThisMonth: Number(value) || 0,
        monthlyCap: config.monthlyCapPerReferrer,
      })
    ) {
      return { granted: false, reason: 'monthly_cap' };
    }
  }

  const ledgerBase = {
    referrerStoreId,
    referredStoreId: input.referredStore.id,
    referredUserId: input.referredStore.referredByUserId ?? null,
    qualifyingReservationId: input.reservationId,
    qualifyingPaymentId: input.paymentId ?? null,
    qualifyingAmountCents: input.qualifyingAmountCents,
    currency,
    stripePaymentIntentId: input.stripePaymentIntentId ?? null,
    stripeChargeId: input.stripeChargeId ?? null,
    grantedMonth,
  };

  let capExceeded = false;
  try {
    if (reward.kind === 'invoice_credit') {
      // Create the Stripe credit first (idempotency-keyed) so a transient failure retries
      // without orphaning a ledger row; pending negative items auto-attach to the next invoice.
      let invoiceItemId: string | null = null;
      if (reward.creditCents > 0) {
        const customerId = await getOrCreateStripeCustomer(referrerStoreId);
        const item = await stripe.invoiceItems.create(
          {
            customer: customerId,
            amount: -reward.creditCents,
            currency,
            description: `Récompense de parrainage Louez (${config.referrerRewardFreeReservations} réservations offertes)`,
            metadata: {
              type: 'referral_reward',
              referredStoreId: input.referredStore.id,
              referrerStoreId,
            },
          },
          { idempotencyKey: `referral_reward_credit_${input.referredStore.id}` },
        );
        invoiceItemId = item.id;
      }
      try {
        await db.insert(referralRewards).values({
          id: nanoid(),
          ...ledgerBase,
          stripeInvoiceItemId: invoiceItemId,
          kind: 'invoice_credit',
          freeReservations: 0,
          creditCents: reward.creditCents,
          status: 'granted',
        });
      } catch (error) {
        // The credit was already created; if the ledger row cannot be written for a
        // non-duplicate reason, delete the credit so it never applies with no ledger basis
        // (an orphaned credit could not be clawed back). Duplicates fall through to the
        // outer catch and report already_rewarded.
        if (!isDuplicateError(error) && invoiceItemId) {
          await stripe.invoiceItems.del(invoiceItemId).catch(() => {});
        }
        throw error;
      }
    } else {
      // Free reservations: under the per-referrer subscription lock, re-check the monthly cap
      // (closing the read-then-insert race), then increment the Referrer's granted counter and
      // write the ledger atomically. The ledger insert is last so the whole grant rolls back
      // together on a duplicate race.
      const sub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.storeId, referrerStoreId),
        columns: { id: true },
      });
      await db.transaction(async (tx) => {
        if (sub) {
          await tx.execute(
            sql`SELECT id FROM subscriptions WHERE store_id = ${referrerStoreId} FOR UPDATE`,
          );
        }
        if (config.monthlyCapPerReferrer > 0) {
          const [{ value }] = await tx
            .select({ value: sql<number>`count(*)` })
            .from(referralRewards)
            .where(
              and(
                eq(referralRewards.referrerStoreId, referrerStoreId),
                eq(referralRewards.grantedMonth, grantedMonth),
                eq(referralRewards.status, 'granted'),
              ),
            );
          if (
            !isWithinMonthlyCap({
              rewardedThisMonth: Number(value) || 0,
              monthlyCap: config.monthlyCapPerReferrer,
            })
          ) {
            capExceeded = true;
            return;
          }
        }
        if (sub) {
          await tx
            .update(subscriptions)
            .set({
              freeReservationsGranted: sql`${subscriptions.freeReservationsGranted} + ${reward.freeReservations}`,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.storeId, referrerStoreId));
        } else {
          // Legacy store with no subscription row: persist the welcome allowance + reward.
          await tx.insert(subscriptions).values({
            id: nanoid(),
            storeId: referrerStoreId,
            planSlug: 'pay_as_you_go',
            billingMode: 'pay_as_you_go',
            payAsYouGoConfig: getDefaultPayAsYouGoConfigSnapshot(currency),
            freeReservationsGranted:
              getDefaultFreeReservations() + reward.freeReservations,
          });
        }
        await tx.insert(referralRewards).values({
          id: nanoid(),
          ...ledgerBase,
          stripeInvoiceItemId: null,
          kind: 'free_reservations',
          freeReservations: reward.freeReservations,
          creditCents: 0,
          status: 'granted',
        });
      });
      if (capExceeded) return { granted: false, reason: 'monthly_cap' };
    }
  } catch (error) {
    if (isDuplicateError(error)) {
      return { granted: false, reason: 'already_rewarded' };
    }
    throw error;
  }

  // Notify the Referrer (best-effort; never throws), reflecting the actual reward kind so a
  // subscribed referrer is told about their € credit, not phantom free reservations.
  await notifyReferrerRewardGranted({
    referrerStoreId,
    referredStoreName: input.referredStore.name,
    kind: reward.kind,
    freeReservations: reward.freeReservations,
    displayValueCents: reward.displayValueCents,
  });

  return { granted: true };
}

/**
 * Clawback handler: when the qualifying payment behind a granted Referrer Reward is
 * refunded or disputed within the clawback window, reverse the reward. Free-reservation
 * rewards lose only their not-yet-consumed credits; invoice-credit rewards have their
 * pending Stripe credit removed. Idempotent and a no-op outside the window.
 */
export async function clawbackReferrerRewardForQualifyingPayment(input: {
  stripeChargeId?: string | null;
  stripePaymentIntentId?: string | null;
  at?: Date;
}): Promise<{ clawedBack: boolean; reason?: string }> {
  const where = input.stripeChargeId
    ? eq(referralRewards.stripeChargeId, input.stripeChargeId)
    : input.stripePaymentIntentId
      ? eq(referralRewards.stripePaymentIntentId, input.stripePaymentIntentId)
      : null;
  if (!where) return { clawedBack: false, reason: 'no_reference' };

  const reward = await db.query.referralRewards.findFirst({ where });
  if (!reward) return { clawedBack: false, reason: 'no_reward' };
  if (reward.status !== 'granted') {
    return { clawedBack: false, reason: 'already_clawed_back' };
  }

  const config = getReferralProgramConfig();
  const at = input.at ?? new Date();
  if (
    !isWithinClawbackWindow({
      grantedAt: reward.createdAt,
      eventAt: at,
      clawbackWindowDays: config.clawbackWindowDays,
    })
  ) {
    return { clawedBack: false, reason: 'outside_window' };
  }

  if (reward.kind === 'free_reservations') {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM subscriptions WHERE store_id = ${reward.referrerStoreId} FOR UPDATE`,
      );
      // Claim the clawback atomically: only the invocation that flips the status from
      // 'granted' to 'clawed_back' proceeds to decrement, so a re-delivered or concurrent
      // event (a refund AND a dispute on the same payment resolve to the same reward row)
      // never double-revokes the referrer's free-reservation balance.
      const claim = await tx
        .update(referralRewards)
        .set({ status: 'clawed_back', clawedBackAt: at, updatedAt: new Date() })
        .where(
          and(
            eq(referralRewards.id, reward.id),
            eq(referralRewards.status, 'granted'),
          ),
        );
      if ((claim[0]?.affectedRows ?? 0) === 0) return;

      const billing = await getStoreBilling(reward.referrerStoreId);
      const used = Math.max(
        0,
        billing.freeReservationsGranted - billing.freeReservationsRemaining,
      );
      const { revoke } = computeFreeReservationClawback({
        rewardFreeReservations: reward.freeReservations,
        grantedTotal: billing.freeReservationsGranted,
        usedTotal: used,
      });
      if (revoke > 0) {
        await tx
          .update(subscriptions)
          .set({
            freeReservationsGranted: sql`GREATEST(0, ${subscriptions.freeReservationsGranted} - ${revoke})`,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.storeId, reward.referrerStoreId));
      }
    });
  } else {
    // Invoice credit: claim the clawback atomically first (so a re-delivered or concurrent
    // event does nothing), then drop the pending Stripe item if it has not been invoiced yet.
    const claim = await db
      .update(referralRewards)
      .set({ status: 'clawed_back', clawedBackAt: at, updatedAt: new Date() })
      .where(
        and(
          eq(referralRewards.id, reward.id),
          eq(referralRewards.status, 'granted'),
        ),
      );
    if ((claim[0]?.affectedRows ?? 0) === 0) {
      return { clawedBack: false, reason: 'already_clawed_back' };
    }
    if (reward.stripeInvoiceItemId) {
      try {
        await stripe.invoiceItems.del(reward.stripeInvoiceItemId);
      } catch (error) {
        // Already invoiced/deleted out of band — the credit stands, but the reward is
        // already marked clawed back so the event is not re-processed. Non-fatal.
        console.warn('[referral] could not delete reward invoice item on clawback', {
          rewardId: reward.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { clawedBack: true };
}
