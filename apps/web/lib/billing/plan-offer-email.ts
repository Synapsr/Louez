import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";

import { enqueueEffects } from "@louez/api/platform/effects";
import { db, paymentDisputes, payments, platformFees, reservations, stores } from "@louez/db";

import { dispatchApiEffects } from "@/lib/api/effects";
import { isBillingEnabled } from "@/lib/billing/mode";
import { log } from "@/lib/evlog";
import { ACTIVE_FEE_STATUSES } from "@/lib/pay-as-you-go/metering";

import { evaluatePlanOffer } from "./plan-offer";
import { planOfferMonths } from "./plan-offer-core";

// The owner's one e-mail about the plan offer (docs/domain/plan-offer.md): once a day,
// the stores that may have paid Louez more than a plan in the running or the last
// month are checked with the card's rule; the first time one passes, it is marked and
// its e-mail queued in the same transaction, so it is queued once, ever.

/** The cheapest plan price there is, excluding VAT: a legacy month below it needs no look. */
const CHEAPEST_PLAN_MINOR = 4900;

/**
 * A day's run checks at most this many stores. When there are more, each day takes the
 * next ones in a fixed order (rotateDaily), so every candidate is checked in turn.
 */
const MAX_STORES_PER_RUN = 500;

/** Stores checked at once: each check of a store the service bills reads its statements. */
const CONCURRENCY = 4;

/** When the daily run goes: 08:15 UTC, morning in Europe. */
export function isPlanOfferEmailTick(now: Date): boolean {
  return now.getUTCHours() === 8 && now.getUTCMinutes() === 15;
}

/**
 * Stores never e-mailed whose legacy fees of one of the two months pass the cheapest
 * plan without VAT: what they paid is recorded, so the rule decides the rest.
 */
async function legacyCandidates(now: Date): Promise<string[]> {
  const months = planOfferMonths(now);
  const paid = sql<number>`sum(${platformFees.amountCents} - ${platformFees.amountReversedCents})`;
  const rows = await db
    .select({ storeId: platformFees.storeId })
    .from(platformFees)
    .innerJoin(stores, eq(stores.id, platformFees.storeId))
    .where(
      and(
        isNull(stores.planOfferNotifiedAt),
        inArray(platformFees.billingMonth, [months.current, months.previous]),
        inArray(platformFees.status, [...ACTIVE_FEE_STATUSES]),
        inArray(platformFees.source, ["online", "manual"]),
      ),
    )
    .groupBy(platformFees.storeId, platformFees.billingMonth)
    .having(sql`${paid} > ${CHEAPEST_PLAN_MINOR}`);
  return rows.map((row) => row.storeId);
}

/**
 * Stores never e-mailed with a reservation, a payment or a dispute since a week before
 * the last month began: only the billing service knows what they owe (minimums per payment,
 * commission on unpaid totals), so nothing narrower is safe; the rule reads their
 * statements. A store with no such activity owes nothing for those months.
 */
async function activeCandidates(now: Date): Promise<string[]> {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1) - 7 * 86_400_000);
  const [byReservation, byPayment, byDispute] = await Promise.all([
    db
      .selectDistinct({ storeId: reservations.storeId })
      .from(reservations)
      .innerJoin(stores, eq(stores.id, reservations.storeId))
      .where(
        and(
          isNull(stores.planOfferNotifiedAt),
          or(gte(reservations.createdAt, since), gte(reservations.endDate, since)),
        ),
      ),
    db
      .selectDistinct({ storeId: reservations.storeId })
      .from(payments)
      .innerJoin(reservations, eq(reservations.id, payments.reservationId))
      .innerJoin(stores, eq(stores.id, reservations.storeId))
      .where(and(isNull(stores.planOfferNotifiedAt), gte(payments.createdAt, since))),
    // A dispute opened or closed lately on an older payment moves its commission.
    db
      .selectDistinct({ storeId: reservations.storeId })
      .from(paymentDisputes)
      .innerJoin(reservations, eq(reservations.id, paymentDisputes.reservationId))
      .innerJoin(stores, eq(stores.id, reservations.storeId))
      .where(and(isNull(stores.planOfferNotifiedAt), gte(paymentDisputes.updatedAt, since))),
  ]);
  return [...byReservation, ...byPayment, ...byDispute].map((row) => row.storeId);
}

/**
 * The day's share of the candidates: all of them when they fit in a run, otherwise
 * `MAX_STORES_PER_RUN` of them in id order, starting where the day's number points,
 * so the window moves each day and wraps around.
 */
export function rotateDaily(storeIds: readonly string[], now: Date): string[] {
  const sorted = [...new Set(storeIds)].sort();
  if (sorted.length <= MAX_STORES_PER_RUN) return sorted;
  const day = Math.floor(now.getTime() / 86_400_000);
  const start = (day * MAX_STORES_PER_RUN) % sorted.length;
  return [...sorted.slice(start), ...sorted.slice(0, start)].slice(0, MAX_STORES_PER_RUN);
}

/**
 * Marks the store e-mailed and queues its e-mail, in one transaction, unless another
 * run marked it first. The ids of the rows to send, or none.
 */
async function queueEmail(storeId: string, now: Date): Promise<string[]> {
  const { offer } = await evaluatePlanOffer(storeId, now, { ignoreDismissal: true });
  if (!offer) return [];
  return db.transaction(async (tx) => {
    const [marked] = await tx
      .update(stores)
      .set({ planOfferNotifiedAt: now })
      .where(and(eq(stores.id, storeId), isNull(stores.planOfferNotifiedAt)));
    if (marked.affectedRows !== 1) return [];
    return enqueueEffects(tx, storeId, [
      { type: "billing.planOfferEmail", payload: { storeId, offer } },
    ]);
  });
}

/**
 * The day's run: the owners of the stores a plan would have cost less get their one
 * e-mail. A store that fails is logged and checked again the next day.
 */
export async function queuePlanOfferEmails(now: Date) {
  if (!isBillingEnabled()) return { candidates: 0, queued: 0, failed: 0 };
  const [legacy, active] = await Promise.all([legacyCandidates(now), activeCandidates(now)]);
  const storeIds = rotateDaily([...legacy, ...active], now);
  let queued = 0;
  let failed = 0;
  const queue = [...storeIds];
  const worker = async () => {
    for (let storeId = queue.shift(); storeId; storeId = queue.shift()) {
      try {
        const ids = await queueEmail(storeId, now);
        if (ids.length > 0) {
          queued += 1;
          dispatchApiEffects(ids);
        }
      } catch (error) {
        failed += 1;
        log.error("billing", `plan offer e-mail of store ${storeId} not queued: ${String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { candidates: storeIds.length, queued, failed };
}
