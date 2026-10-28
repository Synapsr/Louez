import { and, eq } from "drizzle-orm";

import {
  storeLegalProfiles,
  storeMarketplaceChannels,
  storeMembers,
  stores,
  subscriptions,
} from "@louez/db";

import { normalizeCurrency } from "@/lib/billing-sync/money";
import { type PlanRow, planInForce } from "@/lib/plan-limits";

import type { BuiltSnapshot, SnapshotKey, SnapshotReader } from "./build-snapshot";
import {
  type SnapshotChecks,
  compareCodeUnits,
  countryOrNull,
  snapshotChecks,
} from "./snapshot-checks";
import type { StorePlanSnapshot, StoreSnapshotData } from "./snapshot-data";

// openapi.yaml StoreSnapshotV1. No store name, contact or legal identity (README §11,
// Q2): the slug, ids, settings codes, Connect and marketplace facts, and the Louez plan.

const MAX_OWNERS = 50;

/** The plan in force on the store's row (planInForce, README §8.7), or null. */
function planSnapshot(
  checks: SnapshotChecks,
  row: (PlanRow & { readonly stripeCustomerId: string | null }) | null,
): StorePlanSnapshot | null {
  if (!planInForce(row)) return null;
  if (row.planSlug !== "pro" && row.planSlug !== "ultra")
    return checks.fail(`plan ${row.planSlug} is not one the contract knows`);
  return {
    slug: row.planSlug,
    status: row.status,
    stripeCustomerId: checks.textOrNull("plan.stripeCustomerId", row.stripeCustomerId || null, 255),
  };
}

export async function buildStoreSnapshot(
  db: SnapshotReader,
  key: SnapshotKey,
): Promise<BuiltSnapshot<StoreSnapshotData>> {
  const checks = snapshotChecks(`store ${key.storeId}`);
  if (key.aggregateId !== key.storeId)
    checks.fail(`aggregate id ${key.aggregateId} is not the store id`);

  const [store] = await db
    .select({
      slug: stores.slug,
      createdAt: stores.createdAt,
      onboardingCompleted: stores.onboardingCompleted,
      settings: stores.settings,
      stripeAccountId: stores.stripeAccountId,
      stripeChargesEnabled: stores.stripeChargesEnabled,
      stripeOnboardingComplete: stores.stripeOnboardingComplete,
      referredByStoreId: stores.referredByStoreId,
      referredByUserId: stores.referredByUserId,
      signupOrigin: stores.signupOrigin,
    })
    .from(stores)
    .where(eq(stores.id, key.storeId))
    .limit(1);
  if (!store) return { kind: "missing" };

  const owners = await db
    .select({ userId: storeMembers.userId })
    .from(storeMembers)
    .where(and(eq(storeMembers.storeId, key.storeId), eq(storeMembers.role, "owner")));
  checks.limit("ownerUserIds", owners.length, MAX_OWNERS);

  const [legalProfile] = await db
    .select({
      country: storeLegalProfiles.country,
      invoicingEnabled: storeLegalProfiles.invoicingEnabled,
    })
    .from(storeLegalProfiles)
    .where(eq(storeLegalProfiles.storeId, key.storeId))
    .limit(1);

  const [channel] = await db
    .select({
      status: storeMarketplaceChannels.status,
      publishedAt: storeMarketplaceChannels.publishedAt,
      cohortRank: storeMarketplaceChannels.cohortRank,
      lifetimeFeeWaiverAt: storeMarketplaceChannels.lifetimeFeeWaiverAt,
    })
    .from(storeMarketplaceChannels)
    .where(eq(storeMarketplaceChannels.storeId, key.storeId))
    .limit(1);

  const [subscription] = await db
    .select({
      billingMode: subscriptions.billingMode,
      planSlug: subscriptions.planSlug,
      status: subscriptions.status,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      stripeCustomerId: subscriptions.stripeCustomerId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.storeId, key.storeId))
    .limit(1);

  const settings = store.settings;
  const timezone = typeof settings?.timezone === "string" ? settings.timezone : null;
  const data: StoreSnapshotData = {
    deleted: false,
    slug: checks.text("slug", store.slug, 100),
    createdAt: checks.timestamp("createdAt", store.createdAt),
    onboardingCompleted: store.onboardingCompleted ?? false,
    currency: normalizeCurrency(settings?.currency),
    country: countryOrNull(settings?.country),
    timezone: checks.textOrNull("timezone", timezone, 64),
    ownerUserIds: [...new Set(owners.map((owner) => owner.userId))].sort(compareCodeUnits),
    // The legal entity's country counts once the store invoices from Louez.
    legalCountry: legalProfile?.invoicingEnabled ? countryOrNull(legalProfile.country) : null,
    stripeConnect: {
      accountId: store.stripeAccountId,
      chargesEnabled: store.stripeChargesEnabled ?? false,
      onboardingComplete: store.stripeOnboardingComplete ?? false,
    },
    marketplace: {
      status: channel?.status ?? null,
      firstPublishedAt: checks.timestampOrNull(
        "marketplace.firstPublishedAt",
        channel?.publishedAt ?? null,
      ),
      cohortRank: checks.positiveOrNull("marketplace.cohortRank", channel?.cohortRank ?? null),
      lifetimeFeeWaiverAt: checks.timestampOrNull(
        "marketplace.lifetimeFeeWaiverAt",
        channel?.lifetimeFeeWaiverAt ?? null,
      ),
    },
    referral: {
      referredByStoreId: store.referredByStoreId,
      referredByUserId: store.referredByUserId,
      signupOrigin: checks.textOrNull("referral.signupOrigin", store.signupOrigin, 32),
    },
    finalReservations: null,
    plan: planSnapshot(checks, subscription ?? null),
  };
  return { kind: "snapshot", data };
}
