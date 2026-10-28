import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";
import { ChatIcon } from "@louez/ui/icons";

import { PayAsYouGoPreview } from "@/app/(dashboard)/dashboard/subscription/pay-as-you-go-preview";
import { PayAsYouGoSummary } from "@/app/(dashboard)/dashboard/subscription/pay-as-you-go-summary";
import { SubscriptionManagement } from "@/app/(dashboard)/dashboard/subscription/subscription-management";
import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { requirePlatformBilling } from "@/lib/billing/require-billing";
import { syncStorePaymentMethodStatus } from "@/lib/discord/platform-notifications";
import {
  getCurrentMonthUsage,
  getRecentPayAsYouGoInvoices,
  getStoreBilling,
  summarizePayAsYouGoBands,
} from "@/lib/pay-as-you-go";
import { canAddTeamMember, canSendSms, getStoreUsage } from "@/lib/plan-limits";
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

const SettingsSubscriptionPage = async ({ searchParams }: SettingsSubscriptionPageProps) => {
  requirePlatformBilling();
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const t = await getTranslations("dashboard.settings.subscription");
  const params = await searchParams;
  const billing = await getStoreBilling(store.id);

  if (billing.billingMode === "pay_as_you_go" && !params.plans) {
    const [usage, invoices, hasPaymentMethod] = await Promise.all([
      getCurrentMonthUsage(store.id, new Date(), billing),
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

  const plans = getPlans();
  const canAccessBillingPortal = await hasStripeCustomer(store.id);
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
        subscription={subscription}
        plans={plans}
        canAccessBillingPortal={canAccessBillingPortal}
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
        pendingBillingMode={subscription?.pendingBillingMode ?? null}
        showBackToPayAsYouGo={isPayAsYouGo}
      />
    </SettingsPageShell>
  );
};

export default SettingsSubscriptionPage;
