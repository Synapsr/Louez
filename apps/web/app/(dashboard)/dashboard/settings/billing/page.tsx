import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { BuildingIcon, FileTextIcon } from "@louez/ui/icons";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { DashboardListRow } from "@/components/dashboard/shared/dashboard-list-row";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { describeBillingOverview } from "@/lib/billing/billing-overview";
import { withBillingReturnOutcome } from "@/lib/billing/billing-return";
import { BILLING_SETTINGS_PATH, BILLING_STATEMENTS_PATH } from "@/lib/billing/billing-routes";
import { finishCardReturn, readCheckoutSessionId } from "@/lib/billing/card-return";
import { requireBillingPages } from "@/lib/billing/require-billing-pages";
import { getBillingDetails, getBillingOverview } from "@/lib/billing-sync/pages";

import { BillingCardSection } from "./billing-card-section";
import { BillingDetailsFormView } from "./billing-details-form";
import { BillingMonthCard } from "./billing-month-card";
import { BillingNotLoaded } from "./billing-not-loaded";
import { BillingOverviewCard } from "./billing-overview-card";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * "Facturation" (louez-billing docs/api, README §10; design §6.1): the offer and the
 * card gate from the cached policy, then, from the billing service, this month, the
 * billing card with the unpaid balance, the billing details, and the way to the
 * statements. Stripe
 * Checkout comes back here with `?checkout=`: the card is saved, then the page shows
 * once more with the toast.
 */
export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { store, access } = await requireBillingPages();
  const readOnly = access.role !== "owner";

  const checkoutSessionId = readCheckoutSessionId((await searchParams).checkout);
  if (checkoutSessionId && !readOnly) {
    const outcome = await finishCardReturn({ storeId: store.id, checkoutSessionId, after });
    redirect(withBillingReturnOutcome(BILLING_SETTINGS_PATH, outcome));
  }

  const locale = await getLocale();
  const [t, overview, details] = await Promise.all([
    getTranslations("dashboard.settings.billing"),
    getBillingOverview(store.id, locale),
    getBillingDetails(store.id),
  ]);

  return (
    <SettingsPageShell title={t("label")} description={t("description")}>
      <BillingOverviewCard overview={describeBillingOverview(access, locale)} />

      {overview.ok ? (
        <>
          {overview.value.month && (
            <BillingMonthCard
              month={overview.value.month}
              timeZone={overview.value.timeZone}
              locale={locale}
            />
          )}
          <BillingCardSection
            card={overview.value.card}
            savedCard={overview.value.savedCard}
            balance={overview.value.balance}
            asksForCard={overview.value.notice?.kind === "add_card"}
            unavailable={overview.value.cardSetupUnavailable}
            readOnly={readOnly}
          />
        </>
      ) : (
        <BillingNotLoaded failure={overview} />
      )}

      <DashboardSectionCard
        title={t("details.title")}
        description={t("details.description")}
        icon={BuildingIcon}
      >
        {details.ok && details.value.kind === "ready" ? (
          <BillingDetailsFormView details={details.value} readOnly={readOnly} />
        ) : details.ok ? (
          <p className="text-muted-foreground text-sm">
            {details.value.kind === "no_customer" ? t("details.noCustomer") : t("details.unavailable")}
          </p>
        ) : (
          <BillingNotLoaded failure={details} />
        )}
      </DashboardSectionCard>

      <DashboardSectionCard title={t("statements.title")} contentClassName="space-y-1">
        <DashboardListRow
          href={BILLING_STATEMENTS_PATH}
          leading={<DashboardIconTile icon={FileTextIcon} size="sm" />}
          title={<span className="font-medium">{t("statements.title")}</span>}
          subtitle={t("statements.description")}
        />
      </DashboardSectionCard>
    </SettingsPageShell>
  );
}
