import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { getLocale, getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";
import { ChatIcon } from "@louez/ui/icons";

import { PayAsYouGoPreview } from "@/app/(dashboard)/dashboard/subscription/pay-as-you-go-preview";
import { PayAsYouGoSummary } from "@/app/(dashboard)/dashboard/subscription/pay-as-you-go-summary";
import {
  SubscriptionManagement,
  type SubscriptionManagementProps,
} from "@/app/(dashboard)/dashboard/subscription/subscription-management";
import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { BILLING_SETTINGS_PATH } from "@/lib/billing/billing-routes";
import { getBillingHandoffAccess } from "@/lib/billing/handoff-access";
import {
  getEffectivePolicy,
  getUncreatedStorePolicy,
  legacyBillingApplies,
} from "@/lib/billing/policy";
import { requirePlatformBilling } from "@/lib/billing/require-billing";
import { describeNewStoreSubscriptionPage } from "@/lib/billing/subscription-page";
import { syncStorePaymentMethodStatus } from "@/lib/discord/platform-notifications";
import {
  getCurrentMonthUsage,
  getRecentPayAsYouGoInvoices,
  getStoreBilling,
  summarizePayAsYouGoBands,
} from "@/lib/pay-as-you-go";
import { canAddTeamMember, canSendSms, getStoreUsage } from "@/lib/plan-limits";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { hasLiveSubscription } from "@/lib/stripe/subscription-status";
import {
  getPlans,
  getSubscriptionWithPlan,
  hasStripeCustomer,
  storeHasDefaultPaymentMethod,
} from "@/lib/stripe/subscriptions";
import { getCurrentStore } from "@/lib/store-context";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

type SettingsSubscriptionPageProps = {
  searchParams: Promise<{
    canceled?: string;
    payg?: string;
    plans?: string;
    success?: string;
  }>;
};

/**
 * "Abonnement": Louez's plans, for every store (louez-billing docs/api, README §8.7).
 * A store Louez's legacy code bills also gets its pay-as-you-go usage and invoices. A
 * store the billing service bills gets the plans at once, with the service's words for
 * pay-as-you-go and a link to its billing settings.
 */
const SettingsSubscriptionPage = async ({ searchParams }: SettingsSubscriptionPageProps) => {
  requirePlatformBilling();
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.settings.subscription");
  const params = await searchParams;
  const now = new Date();
  let grid: Pick<
    SubscriptionManagementProps,
    | "subscription"
    | "canAccessBillingPortal"
    | "pendingBillingMode"
    | "showBackToPayAsYouGo"
    | "hasLiveSubscription"
    | "offerLabel"
    | "billingSettingsHref"
  >;

  if (await legacyBillingApplies(store.id, now)) {
    const billing = await getStoreBilling(store.id);

    if (billing.billingMode === "pay_as_you_go" && !params.plans) {
      const [usage, invoices, hasPaymentMethod] = await Promise.all([
        getCurrentMonthUsage(store.id, now, billing),
        getRecentPayAsYouGoInvoices(store.id),
        storeHasDefaultPaymentMethod(store.id),
      ]);

      after(() => syncStorePaymentMethodStatus(store.id, hasPaymentMethod));

      return (
        <SettingsPageShell title={t("label")} description={t("description")}>
          <PayAsYouGoSummary
            billingMonth={usage.billingMonth}
            locationCount={usage.locationCount}
            grossCents={usage.grossCents}
            collectedAtSourceCents={usage.collectedAtSourceCents}
            dueCents={usage.dueCents}
            currency={usage.currency}
            flatRateCents={usage.config.flatRateCents}
            bands={usage.bands}
            hasPaymentMethod={hasPaymentMethod}
            invoices={invoices}
            freeReservationsRemaining={billing.freeReservationsRemaining}
            freeReservationsGranted={billing.freeReservationsGranted}
          />
        </SettingsPageShell>
      );
    }

    const isPayAsYouGo = billing.billingMode === "pay_as_you_go";
    const subscription = await getSubscriptionWithPlan(store.id);

    if (params.payg && !isPayAsYouGo) {
      return (
        <SettingsPageShell title={t("label")} description={t("description")}>
          <PayAsYouGoPreview
            flatRateCents={billing.config.flatRateCents}
            bands={summarizePayAsYouGoBands(billing.config)}
            currency={billing.config.currency}
            isPaidPlan={Boolean(subscription?.stripeSubscriptionId)}
          />
        </SettingsPageShell>
      );
    }

    grid = {
      subscription,
      canAccessBillingPortal: await hasStripeCustomer(store.id),
      pendingBillingMode: subscription?.pendingBillingMode ?? null,
      showBackToPayAsYouGo: isPayAsYouGo,
      hasLiveSubscription: hasLiveSubscription(subscription),
    };
  } else {
    const [subscription, policy, defaultPolicy, locale, access] = await Promise.all([
      getSubscriptionWithPlan(store.id),
      getEffectivePolicy(store.id, now),
      getUncreatedStorePolicy(now),
      getLocale(),
      isCurrentUserPlatformAdmin().then((isAdmin) => getBillingHandoffAccess(store, isAdmin, now)),
    ]);
    const page = describeNewStoreSubscriptionPage({
      row: subscription,
      wantsPayAsYouGoPreview: Boolean(params.payg),
      policy,
      defaultPolicy,
      locale,
    });

    if (page.kind === "payg_preview") {
      return (
        <SettingsPageShell title={t("label")} description={t("description")}>
          <PayAsYouGoPreview offerLabel={page.offerLabel} isPaidPlan />
        </SettingsPageShell>
      );
    }

    grid = {
      subscription,
      canAccessBillingPortal: page.canAccessBillingPortal,
      pendingBillingMode: subscription?.pendingBillingMode ?? null,
      showBackToPayAsYouGo: false,
      hasLiveSubscription: page.hasLiveSubscription,
      offerLabel: page.offerLabel,
      billingSettingsHref: access ? BILLING_SETTINGS_PATH : undefined,
    };
  }

  const plans = getPlans();
  const [usage, teamStatus, smsStatus] = await Promise.all([
    getStoreUsage(store.id),
    canAddTeamMember(store.id),
    canSendSms(store.id),
  ]);
  const tSms = await getTranslations("dashboard.sms");

  return (
    <SettingsPageShell
      title={t("label")}
      description={t("description")}
      actions={
        <Button variant="outline" render={<Link href="/dashboard/sms" />}>
          <ChatIcon className="mr-2 size-4" />
          {tSms("title")}
        </Button>
      }
    >
      <SubscriptionManagement
        {...grid}
        plans={plans}
        showSuccess={params.success === "true"}
        showCanceled={params.canceled === "true"}
        usage={{
          products: usage.products,
          reservations: usage.reservationsThisMonth,
          customers: usage.customers,
          collaborators: teamStatus.current,
          collaboratorsLimit: teamStatus.limit,
          sms: smsStatus.current,
          smsLimit: smsStatus.limit,
        }}
        discountPercent={store.discountPercent}
        discountDurationMonths={store.discountDurationMonths}
      />
    </SettingsPageShell>
  );
};

export default SettingsSubscriptionPage;
