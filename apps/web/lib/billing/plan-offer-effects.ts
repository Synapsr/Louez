import { eq } from "drizzle-orm";

import { dashboardPath } from "@louez/api/platform/links";
import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
} from "@louez/api/platform/effects";
import { db, stores, subscriptions, users } from "@louez/db";
import { isEmailConfigured } from "@louez/email";

import { NO_EMAIL } from "@/lib/api/effect-outcomes";
import { withEffectSignal } from "@/lib/api/effect-signal";
import { apiUrls } from "@/lib/api/urls";
import { formatMinor, formatPeriod } from "@/lib/billing/billing-format";
import { isBillingEnabled } from "@/lib/billing/mode";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { isEmailDelivered, sendPlanOfferEmail } from "@/lib/email/send";
import { planInForce } from "@/lib/plan-limits";
import { captureProductServerEventOrThrow } from "@/lib/product-analytics/analytics";
import { productAnalyticsEvents } from "@/lib/product-analytics/analytics-events";

import { planOfferProperties } from "./plan-offer";

// The senders of the plan offer's rows (packages/api services/plan-offer.ts and
// plan-offer-email.ts): a member's close or click on the card, counted in PostHog, and
// the owner's one e-mail. Each throws when nothing went out (the row is retried) and
// answers `skipped` when there is nothing to send.

type Payload<K extends keyof ApiEffectPayloads> = ApiEffectPayloads[K];
type PlanOfferEffectType = "billing.planOfferAnalytics" | "billing.planOfferEmail";

/** Who gets the e-mail, and whether a plan or an admin discount came since it was queued. */
async function readRecipient(storeId: string) {
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, storeId),
    columns: {
      name: true,
      userId: true,
      email: true,
      settings: true,
      theme: true,
      stripeCouponId: true,
      discountPercent: true,
    },
  });
  if (!store) return null;
  const [owner, row] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, store.userId), columns: { email: true } }),
    db.query.subscriptions.findFirst({
      where: eq(subscriptions.storeId, storeId),
      columns: { billingMode: true, planSlug: true, status: true, stripeSubscriptionId: true },
    }),
  ]);
  return {
    to: owner?.email ?? store.email,
    storeName: store.name,
    country: store.settings?.country ?? null,
    primaryColor: store.theme?.primaryColor ?? undefined,
    onPlan: planInForce(row),
    hasAdminDiscount: Boolean(store.stripeCouponId) || store.discountPercent > 0,
  };
}

/** What the senders call. A test replaces them, so nothing leaves the machine. */
export interface PlanOfferEffectDeps {
  captureProductServerEventOrThrow: typeof captureProductServerEventOrThrow;
  isBillingEnabled: typeof isBillingEnabled;
  isEmailConfigured: typeof isEmailConfigured;
  isEmailDelivered: typeof isEmailDelivered;
  readRecipient: typeof readRecipient;
  sendPlanOfferEmail: typeof sendPlanOfferEmail;
}

const defaultDeps: PlanOfferEffectDeps = {
  captureProductServerEventOrThrow,
  isBillingEnabled,
  isEmailConfigured,
  isEmailDelivered,
  readRecipient,
  sendPlanOfferEmail,
};

export function createPlanOfferEffectSenders(
  overrides: Partial<PlanOfferEffectDeps> = {},
): Pick<ApiEffectSenders, PlanOfferEffectType> {
  const deps: PlanOfferEffectDeps = { ...defaultDeps, ...overrides };

  return {
    "billing.planOfferAnalytics": (
      payload: Payload<"billing.planOfferAnalytics">,
      context: EffectSendContext,
    ) =>
      withEffectSignal(context, async () => {
        await context.assertClaim();
        return deps.captureProductServerEventOrThrow({
          distinctId: payload.userId,
          event:
            payload.event === "plan_offer_dismissed"
              ? productAnalyticsEvents.planOfferDismissed
              : productAnalyticsEvents.planOfferClicked,
          properties: planOfferProperties(context.row.storeId, payload.offer),
          // The same event id and time on every try: PostHog keeps one event.
          identity: { eventUuid: payload.eventUuid, occurredAt: payload.occurredAt },
        });
      }),

    "billing.planOfferEmail": (
      payload: Payload<"billing.planOfferEmail">,
      context: EffectSendContext,
    ) =>
      withEffectSignal(context, async () => {
        // A run after a lost outcome finds the e-mail it sent (its log row has this id).
        if (await deps.isEmailDelivered(context.effectId)) return;
        const recipient = await deps.readRecipient(context.row.storeId);
        if (!recipient) return { skipped: "store_gone" };
        // The offer no longer holds: a plan started, or the platform gave a discount.
        if (!deps.isBillingEnabled()) return { skipped: "billing_off" };
        if (recipient.onPlan) return { skipped: "plan_in_force" };
        if (recipient.hasAdminDiscount) return { skipped: "admin_discount" };
        if (!recipient.to) return { skipped: "no_address" };
        if (!deps.isEmailConfigured()) return NO_EMAIL;

        const { offer } = payload;
        const locale = getLocaleFromCountry(recipient.country);
        const money = (minor: number) => formatMinor(minor, offer.currency, locale);
        await context.assertClaim();
        await deps.sendPlanOfferEmail({
          id: context.effectId,
          to: recipient.to,
          storeId: context.row.storeId,
          storeName: recipient.storeName,
          primaryColor: recipient.primaryColor,
          plan: offer.plan === "pro" ? "Pro" : "Ultra",
          source: offer.source,
          period: offer.period,
          month: formatPeriod(offer.month, locale),
          paid: money(offer.paidMinor),
          price: money(offer.planPriceMinor),
          priceWithVat: offer.vatRateBps > 0 ? money(offer.thresholdMinor) : null,
          savings: money(offer.savingsMinor),
          ctaUrl: apiUrls.dashboard(dashboardPath({ id: context.row.storeId }, "/dashboard")),
          locale,
        });
      }),
  };
}
