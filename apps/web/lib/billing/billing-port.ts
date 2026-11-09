import { after } from "next/server";

import type { BillingPort } from "@louez/api";
import { isBillingSyncEnabled } from "@louez/db";

import { localizedLabel } from "@/lib/billing/billing-overview";
import { finishCardReturn } from "@/lib/billing/card-return";
import { isBillingEnabled } from "@/lib/billing/mode";
import { getEffectivePolicy } from "@/lib/billing/policy";
import { getBillingOverview, startCardSetup } from "@/lib/billing-sync/pages";
import { summarizePayAsYouGoBands } from "@/lib/pay-as-you-go/config";
import {
  getCurrentMonthUsage,
  getRecentPayAsYouGoInvoices,
  getStoreBilling,
} from "@/lib/pay-as-you-go/metering";
import { planInForce } from "@/lib/plan-limits";
import { fromStripeCents } from "@/lib/stripe";
import { getSubscriptionWithPlan, storeHasDefaultPaymentMethod } from "@/lib/stripe/subscriptions";

// What the agent-ready API reads of Louez's billing (packages/api ports.billing):
// what the billing pages show, from the same functions, and the billing card's
// Checkout. Read-only but for the card.

type Status = Awaited<ReturnType<BillingPort["status"]>>;

/** Minor units as a decimal string, in the currency's own decimals. */
function money(minor: number, currency: string) {
  const code = currency.toUpperCase();
  const zeroDecimal = fromStripeCents(1, code) === 1;
  return { amount: fromStripeCents(minor, code).toFixed(zeroDecimal ? 0 : 2), currency: code };
}

type SubscriptionWithPlan = Awaited<ReturnType<typeof getSubscriptionWithPlan>>;

/** The plan in force on the row, or a plan the store is leaving at its period's end. */
function planOf(subscription: SubscriptionWithPlan): Status["plan"] {
  if (!subscription || !planInForce(subscription) || !subscription.plan) return null;
  const pending = subscription.pendingPlanChange;
  return {
    slug: subscription.planSlug,
    name: subscription.plan.name,
    status: subscription.status,
    interval: subscription.billingInterval,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
    pendingChange: pending
      ? { planSlug: pending.planSlug, interval: pending.interval }
      : subscription.pendingBillingMode === "pay_as_you_go"
        ? { planSlug: "pay_as_you_go", interval: null }
        : null,
  };
}

const NONE: Status = {
  billing: "none",
  mode: null,
  plan: null,
  offer: null,
  notice: null,
  payAsYouGo: null,
  card: null,
  invoices: [],
  service: null,
  cardSetupOpen: false,
  cardSetupBlocked: null,
};

async function legacyStatus(storeId: string, now: Date): Promise<Status> {
  const [billing, subscription] = await Promise.all([
    getStoreBilling(storeId),
    getSubscriptionWithPlan(storeId),
  ]);
  const plan = planOf(subscription);
  const base = {
    ...NONE,
    billing: "legacy" as const,
    plan,
    cardSetupBlocked: "not_billed_by_service" as const,
  };
  if (billing.billingMode !== "pay_as_you_go") return { ...base, mode: "subscription" };

  const [usage, invoices, hasCard] = await Promise.all([
    getCurrentMonthUsage(storeId, now, billing),
    getRecentPayAsYouGoInvoices(storeId),
    storeHasDefaultPaymentMethod(storeId),
  ]);
  const currency = usage.currency;
  return {
    ...base,
    mode: "pay_as_you_go",
    payAsYouGo: {
      bands: summarizePayAsYouGoBands(usage.config).map((band) => ({
        from: band.from,
        to: band.to,
        fee: money(band.priceCents, currency),
      })),
      freeReservations: {
        granted: billing.freeReservationsGranted,
        remaining: billing.freeReservationsRemaining,
      },
      month: {
        period: usage.billingMonth,
        reservations: usage.locationCount,
        fees: money(usage.grossCents, currency),
        collectedAtSource: money(usage.collectedAtSourceCents, currency),
        due: money(usage.dueCents, currency),
      },
    },
    card: {
      state: hasCard ? "saved" : "missing",
      brand: null,
      last4: null,
      expMonth: null,
      expYear: null,
      expired: false,
    },
    invoices: invoices.map((invoice) => ({
      period: invoice.billingMonth,
      amount: money(invoice.invoicedAmountCents, invoice.currency),
      status: invoice.status,
      paidAt: invoice.paidAt,
    })),
  };
}

async function serviceStatus(storeId: string, locale: string, now: Date): Promise<Status> {
  const [policy, subscription, overview] = await Promise.all([
    getEffectivePolicy(storeId, now),
    getSubscriptionWithPlan(storeId),
    getBillingOverview(storeId, locale),
  ]);
  const labels = policy.policy?.labels;
  const base: Status = {
    ...NONE,
    billing: "service",
    mode: planInForce(subscription) ? "subscription" : "pay_as_you_go",
    plan: planOf(subscription),
    offer: labels ? localizedLabel(labels.offer, locale) : null,
    notice: labels?.notice ? localizedLabel(labels.notice, locale) : null,
  };
  if (!overview.ok) {
    // The service decides when the user opens the link.
    return {
      ...base,
      card: null,
      service: { reachable: false, month: null, balance: null },
      cardSetupOpen: true,
    };
  }
  const { value } = overview;
  return {
    ...base,
    card: {
      state: value.card,
      brand: value.savedCard?.brand ?? null,
      last4: value.savedCard?.last4 ?? null,
      expMonth: value.savedCard?.expMonth ?? null,
      expYear: value.savedCard?.expYear ?? null,
      expired: value.savedCard?.expired ?? false,
    },
    service: {
      reachable: true,
      month: value.month
        ? {
            period: value.month.period,
            statementAt: value.month.statementAt,
            currencies: value.month.currencies.map((entry) => ({
              atSource: money(entry.atSourceMinor, entry.currency),
              due: money(entry.dueMinor, entry.currency),
            })),
          }
        : null,
      balance: value.balance
        ? {
            owed: money(value.balance.amountMinor, value.balance.currency),
            limit:
              value.balance.limitMinor === null
                ? null
                : money(value.balance.limitMinor, value.balance.currency),
            standing: value.balance.standing,
          }
        : null,
    },
    cardSetupOpen: value.cardSetupUnavailable === null,
    cardSetupBlocked: value.cardSetupUnavailable,
  };
}

export const billingPort: BillingPort = {
  status: async ({ storeId, locale, now }) => {
    if (!isBillingEnabled()) return NONE;
    const policy = await getEffectivePolicy(storeId, now);
    if (policy.legacyBillingApplies) return legacyStatus(storeId, now);
    if (policy.terms.invoicing !== "service") return NONE;
    return serviceStatus(storeId, locale, now);
  },
  billedByService: async (storeId, now) =>
    isBillingSyncEnabled() &&
    (await getEffectivePolicy(storeId, now)).terms.invoicing === "service",
  startCardSetup: async (input) => {
    const started = await startCardSetup(input.storeId, {
      userId: input.userId,
      locale: input.locale,
      returnUrl: input.returnUrl,
    });
    if (started.ok) return { ok: true, url: started.value.url };
    return { ok: false, reason: started.reason === "failed" ? "failed" : "unavailable" };
  },
  finishCardSetup: ({ storeId, checkoutSessionId }) =>
    finishCardReturn({ storeId, checkoutSessionId, after }),
};
