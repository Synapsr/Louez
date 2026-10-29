import { getLocale, getTranslations } from "next-intl/server";

import { Alert, AlertDescription, Badge } from "@louez/ui";
import { FileTextIcon, InfoCircleIcon } from "@louez/ui/icons";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { DashboardListRow } from "@/components/dashboard/shared/dashboard-list-row";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { formatDay, formatMinor, formatPeriod } from "@/lib/billing/billing-format";
import { BILLING_SETTINGS_PATH, BILLING_STATEMENTS_PATH } from "@/lib/billing/billing-routes";
import { requireBillingPages } from "@/lib/billing/require-billing-pages";
import { getBillingStatements } from "@/lib/billing-sync/pages";

import { BillingNotLoaded } from "@/app/(dashboard)/dashboard/settings/billing/billing-not-loaded";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The statements (louez-billing docs/api, README §10; fees.md §10.4): one per month and
 * currency, newest first, as the service's ledger stands. Not final before M3, with no
 * invoice yet. A store Louez still bills sees until when.
 */
export default async function BillingStatementsPage() {
  const { store } = await requireBillingPages();
  const locale = await getLocale();
  const [t, statements] = await Promise.all([
    getTranslations("dashboard.settings.billing"),
    getBillingStatements(store.id),
  ]);
  const back = { href: BILLING_SETTINGS_PATH, label: t("label") };

  if (!statements.ok) {
    return (
      <SettingsPageShell title={t("statements.title")} back={back}>
        <BillingNotLoaded failure={statements} />
      </SettingsPageShell>
    );
  }

  const { legacy, timeZone } = statements.value;
  return (
    <SettingsPageShell
      title={t("statements.title")}
      description={t("statements.description")}
      back={back}
    >
      {legacy && (
        <Alert variant="info">
          <InfoCircleIcon />
          <AlertDescription>
            {legacy.until
              ? t("statements.legacyUntil", { date: formatDay(legacy.until, timeZone, locale) })
              : t("statements.legacy")}
          </AlertDescription>
        </Alert>
      )}

      <DashboardSectionCard title={t("statements.title")} contentClassName="space-y-1">
        {statements.value.statements.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("statements.empty")}</p>
        ) : (
          <>
            <p className="text-muted-foreground pb-2 text-sm">{t("statements.notFinal")}</p>
            {statements.value.statements.map((statement) => (
              <DashboardListRow
                key={statement.id}
                href={`${BILLING_STATEMENTS_PATH}/${statement.id}`}
                leading={<DashboardIconTile icon={FileTextIcon} size="sm" />}
                title={
                  <>
                    <span className="font-medium">{formatPeriod(statement.period, locale)}</span>
                    <Badge variant="outline">{t("statements.open")}</Badge>
                  </>
                }
                subtitle={t("statements.summary", {
                  owed: formatMinor(statement.owedMinor, statement.currency, locale),
                  atSource: formatMinor(statement.atSourceMinor, statement.currency, locale),
                })}
                meta={
                  statement.dueMinor < 0
                    ? t("statements.creditOf", {
                        amount: formatMinor(-statement.dueMinor, statement.currency, locale),
                      })
                    : formatMinor(statement.dueMinor, statement.currency, locale)
                }
              />
            ))}
          </>
        )}
      </DashboardSectionCard>
    </SettingsPageShell>
  );
}
