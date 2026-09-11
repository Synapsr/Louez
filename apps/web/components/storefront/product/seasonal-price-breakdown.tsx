"use client";

import { useTranslations } from "next-intl";
import type { PricingSegment, SeasonalPricingConfig } from "@louez/utils";

import { SeasonSwatch } from "@/components/storefront/ui/season-swatch";
import {
  getSeasonToneMap,
  getSeasonalPriceShares,
} from "@/lib/utils/util.storefront-seasonal-pricing";

interface SeasonalPriceBreakdownProps {
  segments?: PricingSegment[];
  /** The product's seasons, so a colour means the same here and in the calendar. */
  seasons?: SeasonalPricingConfig[];
}

/**
 * The seasons a cart line crosses, named once each. The amounts stay on the
 * product page: here the line already carries its own total.
 */
export const SeasonalPriceBreakdown = ({ segments, seasons }: SeasonalPriceBreakdownProps) => {
  const t = useTranslations("storefront.seasonalPricing");
  if (!segments?.length) return null;

  const shares = getSeasonalPriceShares(segments, getSeasonToneMap(seasons));

  return (
    <ul
      aria-label={t("breakdownTitle")}
      className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
      data-slot="seasonal-price-breakdown"
    >
      {shares.map((share) => (
        <li key={share.id} className="flex min-w-0 items-center gap-2">
          <SeasonSwatch toneIndex={share.toneIndex} />
          <span className="truncate">{share.name ?? t("baseSeason")}</span>
        </li>
      ))}
    </ul>
  );
};
