import { eq } from "drizzle-orm";

import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
} from "@louez/api/platform/effects";
import { aiCreditTransactions, db } from "@louez/db";

import { creditAiCredits, getDefaultAiCredits } from "@/lib/ai/advisor/credits";
import { withEffectSignal } from "@/lib/api/effect-signal";
import { areAiCreditsEnabled } from "@/lib/plans";
import {
  captureProductServerEventOrThrow,
  captureServerEventOrThrow,
} from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";
import {
  referralAnalyticsBaseProperties,
  referralAnalyticsEvents,
} from "@/lib/referral/analytics-events";
import { getReferralProgramConfig } from "@/lib/referral/defaults";

// The senders of a new store's outbox rows (packages/api
// services/store-creation.ts): its welcome AI credits, and each analytics
// event of its creation. Each throws when nothing went out (the row is
// retried) and answers `skipped` when there is nothing to do.

type Payload<K extends keyof ApiEffectPayloads> = ApiEffectPayloads[K];
type Outcome = Promise<void | { skipped: string }>;
type StoreCreationEffectType = "store.welcomeCredits" | "store.creationAnalytics";

/** What the senders call. A test replaces them, so nothing leaves the machine. */
export interface StoreCreationEffectDeps {
  areAiCreditsEnabled: typeof areAiCreditsEnabled;
  creditAiCredits: typeof creditAiCredits;
  captureProductServerEventOrThrow: typeof captureProductServerEventOrThrow;
  captureServerEventOrThrow: typeof captureServerEventOrThrow;
}

const defaultDeps: StoreCreationEffectDeps = {
  areAiCreditsEnabled,
  creditAiCredits,
  captureProductServerEventOrThrow,
  captureServerEventOrThrow,
};

/** The dashboard's events keep their properties; the API and agents set their own surface. */
const actorProperties = (transport: "rpc" | "openapi" | "mcp") =>
  transport === "rpc" ? {} : { actor: transport, surface: transport };

async function credited(dedupKey: string): Promise<boolean> {
  const row = await db.query.aiCreditTransactions.findFirst({
    where: eq(aiCreditTransactions.dedupKey, dedupKey),
    columns: { id: true },
  });
  return Boolean(row);
}

export function createStoreCreationEffectSenders(
  overrides: Partial<StoreCreationEffectDeps> = {},
): Pick<ApiEffectSenders, StoreCreationEffectType> {
  const deps: StoreCreationEffectDeps = { ...defaultDeps, ...overrides };
  const guarded =
    <P>(send: (payload: P, context: EffectSendContext) => Outcome) =>
    (payload: P, context: EffectSendContext) =>
      withEffectSignal(context, () => send(payload, context));

  return {
    "store.welcomeCredits": guarded(
      async (payload: Payload<"store.welcomeCredits">, context: EffectSendContext): Outcome => {
        if (!deps.areAiCreditsEnabled()) return { skipped: "AI credits are off here" };
        const credits = getDefaultAiCredits();
        if (credits <= 0) return { skipped: "no welcome credits are set" };
        // Once per store: the key makes a retry a no-op.
        const dedupKey = `grant:${payload.storeId}`;
        await context.assertClaim();
        await deps.creditAiCredits({
          storeId: payload.storeId,
          credits,
          type: "grant",
          dedupKey,
        });
        // creditAiCredits swallows its failures: the row it writes says whether it went through.
        if (!(await credited(dedupKey))) throw new Error("The welcome credits were not granted.");
      },
    ),
    "store.creationAnalytics": guarded(
      async (payload: Payload<"store.creationAnalytics">, context: EffectSendContext): Outcome => {
        const program = getReferralProgramConfig();
        const actor = actorProperties(payload.transport);
        await context.assertClaim();
        if (payload.event === "store_info_saved") {
          return deps.captureProductServerEventOrThrow({
            distinctId: payload.ownerUserId,
            event: productAnalyticsEvents.onboardingStoreInfoSaved,
            properties: { ...payload.properties, ...actor },
          });
        }
        const referral =
          payload.event === "referral_attribution_resolved"
            ? {
                event: referralAnalyticsEvents.attributionResolved,
                program: {
                  referred_reward_free_reservations: program.referredRewardFreeReservations,
                  referrer_reward_free_reservations: program.referrerRewardFreeReservations,
                  min_qualifying_amount_cents: program.minQualifyingAmountCents,
                  monthly_cap_per_referrer: program.monthlyCapPerReferrer,
                  clawback_window_days: program.clawbackWindowDays,
                },
              }
            : {
                event: referralAnalyticsEvents.referredRewardGranted,
                program: {
                  referred_reward_free_reservations: program.referredRewardFreeReservations,
                },
              };
        return deps.captureServerEventOrThrow({
          distinctId: payload.ownerUserId,
          event: referral.event,
          properties: {
            ...referralAnalyticsBaseProperties,
            ...payload.properties,
            ...referral.program,
            ...actor,
          },
        });
      },
    ),
  };
}
