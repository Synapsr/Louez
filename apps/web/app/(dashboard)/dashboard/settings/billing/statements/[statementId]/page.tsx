import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { SettingsPageShell } from "@/components/dashboard/settings-page-shell";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { formatMinor, formatPeriod } from "@/lib/billing/billing-format";
import { BILLING_STATEMENTS_PATH } from "@/lib/billing/billing-routes";
import { requireBillingPages } from "@/lib/billing/require-billing-pages";
import { getBillingStatement } from "@/lib/billing-sync/pages";

import { BillingNotLoaded } from "@/app/(dashboard)/dashboard/settings/billing/billing-not-loaded";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * One statement (louez-billing docs/api, README §10; fees.md §10.4): its totals, then
 * its lines by group, each with its reservation's number and the earlier month a late
 * line corrects. The service resolves the id inside the active store only.
 */
export default async function BillingStatementPage({
  params,
}: {
  params: Promise<{ statementId: string }>;
}) {
  const { store } = await requireBillingPages();
  const { statementId } = await params;
  const locale = await getLocale();
  const [t, statement] = await Promise.all([
    getTranslations("dashboard.settings.billing"),
    getBillingStatement(store.id, statementId),
  ]);
  const back = { href: BILLING_STATEMENTS_PATH, label: t("statements.title") };

  if (!statement.ok) {
    if (statement.reason === "not_found") notFound();
    return (
      <SettingsPageShell title={t("statements.title")} back={back}>
        <BillingNotLoaded failure={statement} />
      </SettingsPageShell>
    );
  }

  const { currency, period, owedMinor, atSourceMinor, dueMinor, groups } = statement.value;
  const money = (amountMinor: number) => formatMinor(amountMinor, currency, locale);
  return (
    <SettingsPageShell
      title={formatPeriod(period, locale)}
      description={t("statements.notFinal")}
      back={back}
    >
      <DashboardSectionCard title={t("statement.totals")}>
        <dl className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <dt className="text-muted-foreground text-sm">{t("statement.owed")}</dt>
            <dd className="font-medium tabular-nums">{money(owedMinor)}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground text-sm">{t("statement.atSource")}</dt>
            <dd className="font-medium tabular-nums">{money(atSourceMinor)}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground text-sm">
              {dueMinor < 0 ? t("statement.credit") : t("statement.due")}
            </dt>
            <dd className="font-medium tabular-nums">{money(Math.abs(dueMinor))}</dd>
          </div>
        </dl>
      </DashboardSectionCard>

      {groups.map(({ group, totalMinor, lines }) => (
        <DashboardSectionCard
          key={group}
          title={t(`statement.groups.${group}`)}
          action={<span className="font-medium tabular-nums">{money(totalMinor)}</span>}
        >
          <ul className="divide-y">
            {lines.map((line) => (
              <li key={line.key} className="flex items-start justify-between gap-4 py-2">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{t(`statement.lines.${line.kind}`)}</p>
                  <p className="text-muted-foreground text-sm">
                    {[
                      line.reservationNumber &&
                        t("statement.reservation", { number: line.reservationNumber }),
                      line.adjustsPeriod &&
                        t("statement.adjusts", {
                          period: formatPeriod(line.adjustsPeriod, locale),
                        }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-sm tabular-nums">{money(line.amountMinor)}</span>
              </li>
            ))}
          </ul>
        </DashboardSectionCard>
      ))}
    </SettingsPageShell>
  );
}
