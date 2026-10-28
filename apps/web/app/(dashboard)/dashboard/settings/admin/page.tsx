import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { requirePlatformBilling } from "@/lib/billing/require-billing";
import { getCurrentStore } from "@/lib/store-context";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getStoreBilling } from "@/lib/pay-as-you-go";
import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { AdminSettingsForm } from "./admin-settings-form";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function AdminSettingsPage() {
  requirePlatformBilling();
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const isAdmin = await isCurrentUserPlatformAdmin();
  if (!isAdmin) {
    redirect("/dashboard/settings");
  }

  const t = await getTranslations("dashboard.settings");

  const billing = await getStoreBilling(store.id);

  return (
    <SettingsPageShell title={t("admin.title")} description={t("admin.description")}>
      <AdminSettingsForm
        trialDays={store.trialDays ?? 0}
        discountPercent={store.discountPercent ?? 0}
        discountDurationMonths={store.discountDurationMonths ?? 0}
        billingMode={billing.billingMode}
        flatRateCents={billing.config.flatRateCents}
        tiers={billing.config.tiers}
        currency={billing.config.currency}
        freeReservationsGranted={billing.freeReservationsGranted}
        freeReservationsRemaining={billing.freeReservationsRemaining}
      />
    </SettingsPageShell>
  );
}
