import { and, asc, eq, ne, sql } from "drizzle-orm";

import { platformFees, referralRewards, stores, subscriptions } from "@louez/db";

import { normalizeCurrency } from "@/lib/billing-sync/money";

import type { BuiltSnapshot, SnapshotContext, SnapshotKey, SnapshotReader } from "./build-snapshot";
import { isRecord, snapshotChecks } from "./snapshot-checks";
import type { LegacyStoreSnapshotData } from "./snapshot-data";

// openapi.yaml LegacyStoreSnapshotV1: the store's frozen legacy tariff, for the
// shadow comparison until M6. A store created at or after BILLING_NEW_STORES_FROM
// has no legacy aggregates (README §8.3, plan decision 4).

const MAX_REFERRAL_REWARDS = 500;

export async function buildLegacyStoreSnapshot(
  db: SnapshotReader,
  key: SnapshotKey,
  context: SnapshotContext,
): Promise<BuiltSnapshot> {
  const checks = snapshotChecks(`legacy_store ${key.storeId}`);
  if (key.aggregateId !== key.storeId)
    checks.fail(`aggregate id ${key.aggregateId} is not the store id`);

  const [store] = await db
    .select({
      createdAt: stores.createdAt,
      trialDays: stores.trialDays,
      discountPercent: stores.discountPercent,
      discountDurationMonths: stores.discountDurationMonths,
      stripeCouponId: stores.stripeCouponId,
    })
    .from(stores)
    .where(eq(stores.id, key.storeId))
    .limit(1);
  if (!store) return { kind: "missing" };
  if (store.createdAt.getTime() >= context.newStoresFrom.getTime())
    return { kind: "skip", reason: "new_store" };

  const [subscription] = await db
    .select({
      billingMode: subscriptions.billingMode,
      planSlug: subscriptions.planSlug,
      status: subscriptions.status,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      stripeCustomerId: subscriptions.stripeCustomerId,
      payAsYouGoConfig: subscriptions.payAsYouGoConfig,
      pricingVersion: subscriptions.pricingVersion,
      freeReservationsGranted: subscriptions.freeReservationsGranted,
    })
    .from(subscriptions)
    .where(eq(subscriptions.storeId, key.storeId))
    .limit(1);

  // Free entries count over the store's whole life; a voided one gave its credit back.
  const [freeUsed] = await db
    .select({ value: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(platformFees)
    .where(
      and(
        eq(platformFees.storeId, key.storeId),
        eq(platformFees.source, "free"),
        ne(platformFees.status, "voided"),
      ),
    );

  const rewards = await db
    .select({
      id: referralRewards.id,
      referredStoreId: referralRewards.referredStoreId,
      kind: referralRewards.kind,
      freeReservations: referralRewards.freeReservations,
      creditCents: referralRewards.creditCents,
      currency: referralRewards.currency,
      grantedMonth: referralRewards.grantedMonth,
      status: referralRewards.status,
      clawedBackAt: referralRewards.clawedBackAt,
    })
    .from(referralRewards)
    .where(eq(referralRewards.referrerStoreId, key.storeId))
    .orderBy(asc(referralRewards.createdAt), asc(referralRewards.id));
  checks.limit("referralRewards", rewards.length, MAX_REFERRAL_REWARDS);

  const config: unknown = subscription?.payAsYouGoConfig ?? null;
  const data: LegacyStoreSnapshotData = {
    billingMode: subscription?.billingMode ?? null,
    planSlug: checks.textOrNull("planSlug", subscription?.planSlug ?? null, 50),
    subscriptionStatus: subscription?.status ?? null,
    stripeSubscriptionId: subscription?.stripeSubscriptionId ?? null,
    stripeCustomerId: subscription?.stripeCustomerId ?? null,
    payAsYouGoConfig: isRecord(config) ? config : null,
    pricingVersion: checks.textOrNull("pricingVersion", subscription?.pricingVersion ?? null, 32),
    freeReservationsGranted: checks.count(
      "freeReservationsGranted",
      subscription?.freeReservationsGranted ?? 0,
    ),
    freeReservationsUsed: checks.count("freeReservationsUsed", freeUsed?.value ?? 0),
    trialDays: checks.count("trialDays", store.trialDays),
    discountPercent: checks.count("discountPercent", store.discountPercent, 100),
    discountDurationMonths: checks.count("discountDurationMonths", store.discountDurationMonths),
    stripeCouponId: store.stripeCouponId,
    referralRewards: rewards.map((reward) => ({
      id: reward.id,
      referredStoreId: reward.referredStoreId,
      kind: reward.kind,
      freeReservations: checks.count(
        `reward ${reward.id} freeReservations`,
        reward.freeReservations,
      ),
      creditMinor: checks.amount(`reward ${reward.id} creditMinor`, reward.creditCents),
      currency: normalizeCurrency(reward.currency),
      grantedMonth: checks.period(`reward ${reward.id} grantedMonth`, reward.grantedMonth),
      status: reward.status,
      clawedBackAt: checks.timestampOrNull(`reward ${reward.id} clawedBackAt`, reward.clawedBackAt),
    })),
  };
  return { kind: "snapshot", data };
}
