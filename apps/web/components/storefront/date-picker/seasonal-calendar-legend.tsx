"use client";

import { useTranslations } from "next-intl";

import { SeasonSwatch } from "@/components/storefront/ui/season-swatch";
import { useFormatMoney } from "@/hooks/use-format-money";
import { usePeriodLabel } from "@/hooks/use-period-label";
import type { SeasonalCalendarPricing } from "@/lib/utils/util.storefront-seasonal-pricing";

/**
 * Reads the marks on the calendar: one chip per rate visible in the months on
 * screen. The dates stay in the calendar itself — repeating them here is what
 * made this a wall of text.
 */
export const SeasonalCalendarLegend = ({ pricing }: { pricing: SeasonalCalendarPricing }) => {
  const t = useTranslations("storefront.seasonalPricing");
  const formatMoney = useFormatMoney();
  const formatPeriod = usePeriodLabel();
  const period = formatPeriod(pricing.periodMinutes);

  return (
    <ul
      aria-label={t("title")}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs"
      data-slot="seasonal-calendar-legend"
    >
      <li className="flex items-center gap-2">
        <SeasonSwatch toneIndex={null} />
        <span className="text-muted-foreground">{t("baseSeason")}</span>
        <span className="tabular-nums">{`${formatMoney(pricing.basePrice)} / ${period}`}</span>
      </li>
      {pricing.seasons.map((season) => (
        <li key={season.id} className="flex items-center gap-2">
          <SeasonSwatch toneIndex={season.toneIndex} />
          <span className="text-muted-foreground">{season.name}</span>
          <span className="tabular-nums">{`${formatMoney(season.basePrice)} / ${period}`}</span>
        </li>
      ))}
    </ul>
  );
};
