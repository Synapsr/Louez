import { getTranslations } from "next-intl/server";

import { CalendarIcon } from "@louez/ui/icons";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { formatDay, formatMinor } from "@/lib/billing/billing-format";
import type { BillingOverviewView } from "@/lib/billing-sync/pages";

type BillingMonthCardProps = {
  month: NonNullable<BillingOverviewView["month"]>;
  timeZone: string;
  locale: string;
};

/**
 * This month's figures while the service bills the store: the fees taken at source,
 * and what the month's statement should leave to pay, or to credit, per currency.
 */
export const BillingMonthCard = async ({ month, timeZone, locale }: BillingMonthCardProps) => {
  const t = await getTranslations("dashboard.settings.billing.month");

  return (
    <DashboardSectionCard title={t("title")} icon={CalendarIcon} contentClassName="space-y-4">
      {month.currencies.map(({ currency, atSourceMinor, dueMinor }) => (
        <dl key={currency} className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <dt className="text-muted-foreground text-sm">{t("atSource")}</dt>
            <dd className="font-medium tabular-nums">
              {formatMinor(atSourceMinor, currency, locale)}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground text-sm">
              {dueMinor < 0 ? t("credit") : t("due")}
            </dt>
            <dd className="font-medium tabular-nums">
              {formatMinor(Math.abs(dueMinor), currency, locale)}
            </dd>
          </div>
        </dl>
      ))}
      <p className="text-muted-foreground text-sm">
        {t("statementAt", { date: formatDay(month.statementAt, timeZone, locale) })}
      </p>
    </DashboardSectionCard>
  );
};
