"use client";

import { Badge } from "@louez/ui";
import { cn } from "@louez/utils";

import { Price } from "@/components/storefront/ui/price";

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
              <Price
                amount={row.price}
                compareAt={isDiscountVisible(row.reductionPercent) ? row.compareAt : null}
                size="sm"
              />
              {showsUnitPrice ? (
                <span className="text-[0.65rem] text-muted-foreground">
                  {formatMoney(Math.round((row.price / duration) / 1.23))} netto / {formatPeriodLabel(comparisonPeriod)}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
};
