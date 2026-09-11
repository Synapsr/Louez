"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@louez/ui";

import { Price } from "@/components/storefront/ui/price";
import { SeasonSwatch } from "@/components/storefront/ui/season-swatch";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { usePeriodLabel } from "@/hooks/use-period-label";
import {
  formatSeasonDateRange,
  type StorefrontSeasonalRate,
} from "@/lib/utils/util.storefront-seasonal-pricing";

import { RateRows } from "./rate-rows";

export const SeasonalRateRow = ({ rate }: { rate: StorefrontSeasonalRate }) => {
  const t = useTranslations("storefront.seasonalPricing");
  const { intl: locale } = useFormatLocale();
  const formatPeriod = usePeriodLabel();
  const base = rate.rows.find((row) => row.id === "__base__");
  if (!base) return null;

  const heading = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
        <span className="flex items-center gap-2 text-sm font-medium">
          <SeasonSwatch toneIndex={rate.toneIndex} />
          {rate.name ?? t("baseSeason")}
        </span>
        <span className="pl-6 text-xs font-normal text-muted-foreground">
          {rate.startDate && rate.endDate
            ? formatSeasonDateRange(rate.startDate, rate.endDate, locale)
            : t("outsideSeasons")}
        </span>
      </span>
      <Price
        amount={base.price}
        per={formatPeriod(base.periodMinutes)}
        size="md"
        className="shrink-0"
      />
    </>
  );

  if (rate.rows.length === 1) {
    return <div className="flex items-center justify-between gap-4 py-4">{heading}</div>;
  }

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-md py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {heading}
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
        />
        <span className="sr-only">{t("durationRates")}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <RateRows
          rows={rate.rows.filter((row) => row.id !== base.id)}
          comparisonPeriodMinutes={base.periodMinutes}
          className="pb-3"
        />
      </CollapsibleContent>
    </Collapsible>
  );
};
