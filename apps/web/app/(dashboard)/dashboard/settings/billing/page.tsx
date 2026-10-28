import { getLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { isBillingGateDisabled, isBillingSyncEnabled } from "@louez/db";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { describeBillingOverview } from "@/lib/billing/billing-overview";
import { getBillingHandoffAccess } from "@/lib/billing/handoff-access";
import { isCurrentUserPlatformAdmin } from "@/lib/platform-admin";
import { getCurrentStore } from "@/lib/store-context";

import { BillingOverviewCard } from "./billing-overview-card";
import { BillingPageLinks } from "./billing-page-links";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * "Facturation": the store's offer and card gate from the cached policy, and the way
 * to the billing service's pages (louez-billing docs/plans/design.md §6.1). Only in
 * service mode, for the viewers of `billingHandoffRole`.
 */
export default async function BillingSettingsPage() {
  await connection();
  if (!isBillingSyncEnabled()) notFound();

  const store = await getCurrentStore();
  if (!store) redirect("/onboarding");

  const access = await getBillingHandoffAccess(store, await isCurrentUserPlatformAdmin());
  if (!access) redirect("/dashboard/settings");

  const [t, locale] = await Promise.all([
    getTranslations("dashboard.settings.billing"),
    getLocale(),
  ]);

  return (
    <SettingsPageShell title={t("label")} description={t("description")}>
      <BillingOverviewCard overview={describeBillingOverview(access, locale, isBillingGateDisabled())} />
      <BillingPageLinks />
    </SettingsPageShell>
  );
}
