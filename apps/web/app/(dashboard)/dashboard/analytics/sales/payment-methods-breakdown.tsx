"use client";

import { useTranslations } from "next-intl";
import type { PaymentMethodKey, PaymentMethodTotal } from "@louez/api/services/sales-analytics";
import { allocateSalesAmounts } from "@louez/api/services/sales-window";

import { CreditCardSolidIcon } from "@louez/ui/icons";
import { cn, formatCurrency } from "@louez/utils";

import {
  DASHBOARD_ACCENT_FILL,
  type DashboardAccent,
} from "@/components/dashboard/shared/dashboard-accent";
import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";

const METHOD_ACCENTS: Record<PaymentMethodKey, DashboardAccent> = {
  stripe: "primary",
  cash: "success",
  card: "progress",
  transfer: "submitted",
  check: "pending",
  other: "neutral",
};

interface PaymentMethodsBreakdownProps {
  data: PaymentMethodTotal[];
  /** The store's current currency, the one these figures are counted in. */
  currency: string;
  className?: string;
}

/** Share of the period's receipts per payment method, ordered by amount. */
export const PaymentMethodsBreakdown = ({
  data,
  currency,
  className,
}: PaymentMethodsBreakdownProps) => {
  const t = useTranslations("dashboard.statistics");
  const total = data.reduce((sum, entry) => sum + entry.amount, 0);

  if (total === 0) {
    return (
      <DashboardEmptyState
        icon={CreditCardSolidIcon}
        description={t("noRevenueData")}
        className={className}
      />
    );
  }

  // A method that brought nothing over the period would only add an empty row.
  const positiveMethods = data
    .filter((entry) => entry.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const shares = allocateSalesAmounts(
    positiveMethods.map((entry) => entry.amount / total),
    1,
  );
  const methods = positiveMethods.map((entry, index) => ({
    ...entry,
    label: t(`paymentMethods.${entry.method}`),
    percentage: Math.round((shares[index] ?? 0) * 100),
    accent: METHOD_ACCENTS[entry.method],
  }));

  return (
    <div className={cn("@container space-y-4", className)}>
      <div className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full">
        {methods.map((method) => (
          <div
            key={method.method}
            className={cn(
              "h-full transition-all duration-500",
              DASHBOARD_ACCENT_FILL[method.accent],
            )}
            style={{ width: `${method.percentage}%` }}
          />
        ))}
      </div>

      {/* The card can land in a narrow grid column, so each row is sized by its
          container: the count and share only show when there is room, and the
          amount wraps to its own right-aligned line rather than colliding with
          the label. */}
      <div className="space-y-2">
        {methods.map((method) => (
          <div
            key={method.method}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  DASHBOARD_ACCENT_FILL[method.accent],
                )}
              />
              <span className="truncate text-sm">{method.label}</span>
              <span className="text-muted-foreground hidden shrink-0 text-xs @min-[22rem]:inline">
                {t("paymentsCount", { count: method.count })}
              </span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
              <span className="font-medium tabular-nums">
                {formatCurrency(method.amount, currency)}
              </span>
              <span className="text-muted-foreground hidden tabular-nums @min-[16rem]:inline">
                ({method.percentage}%)
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
