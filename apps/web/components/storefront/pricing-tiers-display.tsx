"use client";

import { useState } from "react";

import { ChevronDown, ChevronUp, Layers } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PricingMode } from "@louez/types";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@louez/ui";
import { formatCurrency, minutesToPriceDuration } from "@louez/utils";

import { usePeriodLabel } from "@/hooks/use-period-label";
import { getStorefrontRateRows } from "@/lib/utils/storefront-pricing";

import { useStoreCurrency, useStoreMaxDiscountPercent } from "@/contexts/store-context";

// Long rate grids are the norm on hourly products; keep the card short and let
// the visitor open the rest.
const MAX_VISIBLE_ROWS = 4;

interface PricingTier {
  id: string;
  minDuration: number | null;
  discountPercent: string | number | null;
  period?: number | null;
  price?: string | null;
  displayOrder: number | null;
}

interface PricingTiersDisplayProps {
  basePrice: number;
  pricingMode: PricingMode;
  basePeriodMinutes?: number | null;
  tiers: PricingTier[];
  className?: string;
}

export function PricingTiersDisplay({
  basePrice,
  pricingMode,
  basePeriodMinutes,
  tiers,
  className,
}: PricingTiersDisplayProps) {
  const t = useTranslations("storefront.product.tieredPricing");
  const formatPeriodLabel = usePeriodLabel();
  const currency = useStoreCurrency();
  const maxDiscountPercentSetting = useStoreMaxDiscountPercent();
  const [isExpanded, setIsExpanded] = useState(false);

  // Same normalization as the catalog preview: period-based rates and
  // duration discounts both become comparable rows, instead of every
  // rate-based tier collapsing onto the base price. Legacy duration tiers can
  // carry a NULL minDuration meaning "from 1" — pricing still applies them,
  // so the display must too.
  const rateRows = getStorefrontRateRows({
    price: basePrice,
    pricingMode,
    basePeriodMinutes,
    pricingTiers: tiers.map((tier) => ({
      ...tier,
      minDuration: tier.minDuration ?? 1,
    })),
  });

  if (rateRows.length <= 1) return null;

  const hiddenCount = rateRows.length - MAX_VISIBLE_ROWS;
  const hasHiddenRows = hiddenCount > 0;
  const visibleRows =
    hasHiddenRows && !isExpanded ? rateRows.slice(0, MAX_VISIBLE_ROWS) : rateRows;

  const isDiscountVisible = (reductionPercent: number) =>
    reductionPercent > 0 &&
    (maxDiscountPercentSetting == null || reductionPercent <= maxDiscountPercentSetting);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="text-primary size-4" />
          {t("ratesTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {visibleRows.map((rate) => {
          const period = minutesToPriceDuration(rate.periodMinutes);
          const showsUnitPrice = period.duration > 1;

          return (
            <div
              key={rate.id}
              className="hover:bg-muted/50 flex items-center justify-between gap-4 rounded-lg px-3 py-2 text-sm transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  {formatPeriodLabel(rate.periodMinutes, { alwaysShowCount: true })}
                </span>
                {isDiscountVisible(rate.reductionPercent) && (
                  <Badge variant="progress" className="text-xs font-semibold">
                    -{Math.floor(rate.reductionPercent)}%
                  </Badge>
                )}
              </div>
              <div className="text-right">
                <span className="font-semibold">{formatCurrency(rate.price, currency)}</span>
                {showsUnitPrice && (
                  <div className="text-muted-foreground text-xs">
                    {formatCurrency(rate.price / period.duration, currency)}/
                    {formatPeriodLabel(rate.periodMinutes / period.duration)}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {hasHiddenRows && (
          <button
            type="button"
            onClick={() => setIsExpanded((expanded) => !expanded)}
            className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1 pt-1 text-xs font-medium transition-colors"
          >
            {isExpanded ? t("showLess") : t("showMore", { count: hiddenCount })}
            {isExpanded ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        )}
      </CardContent>
    </Card>
  );
}
