"use client";

import { Badge } from "@louez/ui";
import { cn } from "@louez/utils";

import type { StorefrontRateRow } from "@/lib/utils/util.storefront-pricing";

import { useFormatMoney } from "@/hooks/use-format-money";
import { usePeriodLabel } from "@/hooks/use-period-label";

import { useDiscountVisibility } from "@/contexts/store-context";

interface RateRowsProps {
  rows: StorefrontRateRow[];
  className?: string;
  comparisonPeriodMinutes?: number;
}

/**
 * A product's rate grid as rows: period, promo badge when the store
 * advertises the discount, price and unit price. Shared by the product page
 * rates card and anything else that lists tiers.
 */
export const RateRows = ({ rows, className, comparisonPeriodMinutes }: RateRowsProps) => {
  const formatMoney = useFormatMoney();
  const formatPeriodLabel = usePeriodLabel();
  const isDiscountVisible = useDiscountVisibility();

  return (
    <ul className={cn("flex flex-col divide-y divide-border/60", className)} data-slot="rate-rows">
      {rows.map((row) => {
        const comparisonPeriod =
          comparisonPeriodMinutes ?? rows[0]?.periodMinutes ?? row.periodMinutes;
        const duration = row.periodMinutes / comparisonPeriod;
        const showsUnitPrice = duration > 1;

        return (
          <li key={row.id} className="flex items-center justify-between gap-4 py-3 text-sm">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-medium">
                {formatPeriodLabel(row.periodMinutes, { alwaysShowCount: true })}
              </span>
              {isDiscountVisible(row.reductionPercent) ? (
                <Badge variant="promo">-{Math.floor(row.reductionPercent)}%</Badge>
              ) : null}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
              <span className="flex items-baseline gap-2">
                {row.compareAt && isDiscountVisible(row.reductionPercent) ? (
                  <s className="text-xs text-muted-foreground">{formatMoney(row.compareAt)}</s>
                ) : null}
                <span className="font-semibold tracking-tight">{formatMoney(row.price)}</span>
              </span>
              {showsUnitPrice ? (
                <span className="text-xs text-muted-foreground">
                  {formatMoney(row.price / duration)} / {formatPeriodLabel(comparisonPeriod)}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
};
