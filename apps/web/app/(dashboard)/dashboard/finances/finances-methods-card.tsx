"use client";

import { useTranslations } from "next-intl";

import { CreditCardSolidIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";
import type { FinancePaymentMethod, FinanceSummary } from "@louez/validations";

import { DASHBOARD_ACCENT_FILL } from "@/components/dashboard/shared/dashboard-accent";
import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { useFormatMoney } from "@/hooks/use-format-money";

import { METHOD_ACCENTS } from "./finances.constants";

interface FinancesMethodsCardProps {
  methods: FinanceSummary["byMethod"];
  activeMethod: FinancePaymentMethod | null;
  /** Clicking the active method again lifts the filter. */
  onMethodSelect: (method: FinancePaymentMethod | null) => void;
}

/** What came in per payment method: the figures a till is checked against. */
export const FinancesMethodsCard = ({
  methods,
  activeMethod,
  onMethodSelect,
}: FinancesMethodsCardProps) => {
  const t = useTranslations("dashboard.finances.methods");
  const formatMoney = useFormatMoney();
  const highest = Math.max(0, ...methods.map((entry) => entry.moneyIn));

  if (methods.length === 0) {
    return <DashboardEmptyState icon={CreditCardSolidIcon} description={t("empty")} />;
  }

  return (
    <ul className="space-y-1">
      {methods.map((entry) => {
        const isActive = activeMethod === entry.method;
        return (
          <li key={entry.method}>
            <button
              type="button"
              aria-pressed={isActive}
              aria-label={t("filterBy", { method: t(entry.method) })}
              onClick={() => onMethodSelect(isActive ? null : entry.method)}
              className={cn(
                "hover:bg-muted/60 focus-visible:ring-ring w-full space-y-1.5 rounded-lg px-2 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
                isActive && "bg-muted",
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">{t(entry.method)}</span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatMoney(entry.moneyIn)}
                </span>
              </span>
              <span className="bg-muted block h-1.5 w-full overflow-hidden rounded-full">
                <span
                  className={cn(
                    "block h-full rounded-full transition-all duration-500",
                    DASHBOARD_ACCENT_FILL[METHOD_ACCENTS[entry.method]],
                  )}
                  style={{ width: `${highest > 0 ? (entry.moneyIn / highest) * 100 : 0}%` }}
                />
              </span>
              {entry.moneyOut > 0 && (
                <span className="text-muted-foreground block text-xs tabular-nums">
                  {t("out", { amount: formatMoney(entry.moneyOut) })}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};
