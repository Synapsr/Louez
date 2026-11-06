"use client";

import { useTranslations } from "next-intl";

import { ArrowDownLeftSolidIcon, ArrowUpRightIcon, ClockIcon, WalletIcon } from "@louez/ui/icons";
import type { FinanceSummary } from "@louez/validations";

import { DashboardStatCard } from "@/components/dashboard/shared/dashboard-stat-card";
import { useFormatMoney } from "@/hooks/use-format-money";

interface FinancesStatCardsProps {
  totals: FinanceSummary["totals"];
  outstanding: FinanceSummary["outstanding"];
  /** Opens the "À encaisser" tab, the rest of the URL kept. */
  outstandingHref: string;
}

export const FinancesStatCards = ({
  totals,
  outstanding,
  outstandingHref,
}: FinancesStatCardsProps) => {
  const t = useTranslations("dashboard.finances.stats");
  const formatMoney = useFormatMoney();

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <DashboardStatCard
        title={t("moneyIn")}
        value={formatMoney(totals.moneyIn)}
        icon={ArrowDownLeftSolidIcon}
        accent="success"
        trend={totals.moneyInGrowth}
        subtitle={
          totals.moneyInGrowth === null
            ? t("movements", { count: totals.movementCount })
            : t("vsPrevious")
        }
      />
      <DashboardStatCard
        title={t("moneyOut")}
        value={formatMoney(totals.moneyOut)}
        icon={ArrowUpRightIcon}
        accent="neutral"
        subtitle={t("moneyOutHint")}
      />
      <DashboardStatCard
        title={t("net")}
        value={formatMoney(totals.net)}
        icon={WalletIcon}
        accent="primary"
        trend={totals.netGrowth}
        subtitle={totals.netGrowth === null ? t("netHint") : t("vsPrevious")}
      />
      <DashboardStatCard
        title={t("outstanding")}
        value={formatMoney(outstanding.total)}
        icon={ClockIcon}
        accent="pending"
        subtitle={t("outstandingReservations", { count: outstanding.reservationCount })}
        href={outstandingHref}
      />
    </div>
  );
};
