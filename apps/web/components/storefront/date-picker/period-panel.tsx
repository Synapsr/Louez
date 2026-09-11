"use client";

import {
  getVisibleSeasonalPricing,
  groupSeasonsByTone,
  type SeasonalCalendarPricing,
} from "@/lib/utils/util.storefront-seasonal-pricing";

import { useId } from "react";
import { addYears, startOfMonth, format } from "date-fns";
import { useTranslations } from "next-intl";

import { Calendar } from "@louez/ui";
import { LoaderIcon } from "@louez/ui/icons";
import { cn, findSeasonalPricingForDate } from "@louez/utils";

import { labelDayButton } from "react-day-picker";
import { useFormatMoney } from "@/hooks/use-format-money";
import { usePeriodLabel } from "@/hooks/use-period-label";
import {
  SEASON_DAY_CLASSES,
  SEASON_TONE_COUNT,
} from "@/components/storefront/ui/season-tone.constants";
import { SeasonalCalendarLegend } from "./seasonal-calendar-legend";
import { useFormatLocale } from "@/hooks/use-format-locale";

import type { RentalDateCoreState } from "./core/types";
import { TimeSelectField } from "./time-select-field";
import { usePeriodIssueMessage } from "./use-period-issue-message";

export type PeriodPanelVariant = "sheet" | "popover";

interface PeriodPanelProps {
  core: RentalDateCoreState;
  seasonalPricing?: SeasonalCalendarPricing;
  variant: PeriodPanelVariant;
  /** Months side by side; by default two in the popover, one elsewhere. */
  months?: 1 | 2;
  className?: string;
  month?: Date;
  onMonthChange?: (month: Date) => void;
  allowTimeSelectionWithoutDates?: boolean;
  isCheckingAvailability?: boolean;
  isProductUnavailable?: (day: Date) => boolean;
}

/**
 * The editor body shared by every surface, laid out like the dashboard's
 * reservation picker: a range calendar with month and year
 * menus (two months side by side in the popover, one in the sheet), the
 * pickup and return times as two selects, one validation line.
 */
export const PeriodPanel = ({
  core,
  seasonalPricing,
  variant,
  months,
  className,
  month,
  onMonthChange,
  isProductUnavailable,
  allowTimeSelectionWithoutDates = false,
  isCheckingAvailability = false,
}: PeriodPanelProps) => {
  const t = useTranslations("storefront.dateSelection");
  const ts = useTranslations("storefront.seasonalPricing");
  const formatMoney = useFormatMoney();
  const formatPeriod = usePeriodLabel();
  const { dateFns: dateLocale } = useFormatLocale();
  const issueMessage = usePeriodIssueMessage();
  const fieldId = useId();

  const isPopover = variant === "popover";
  const message = core.hasDates ? issueMessage(core.validation) : null;
  const closedMessage = t("businessHours.storeClosed");

  const visibleSeasonalPricing = getVisibleSeasonalPricing(
    seasonalPricing,
    month ?? core.startDate ?? core.minDate,
    months ?? (isPopover ? 2 : 1),
  );
  // One modifier per marker colour: a day carries its season's bar under the
  // date, so the selected range keeps the cell background to itself.
  const seasonTones = [...groupSeasonsByTone(seasonalPricing, SEASON_TONE_COUNT)];

  const calendar = (
    <div
      className={cn("relative", !isPopover && "[&_[data-slot=calendar]]:w-full")}
      aria-busy={isCheckingAvailability}
    >
      <Calendar
        mode="range"
        numberOfMonths={months ?? (isPopover ? 2 : 1)}
        captionLayout="dropdown"
        startMonth={startOfMonth(core.minDate)}
        endMonth={addYears(core.minDate, 2)}
        selected={{ from: core.startDate, to: core.endDate }}
        // `onSelect` keeps the range controlled by `selected` (without it the
        // picker owns an internal copy and ignores our updates); the tapped
        // day, not the computed range, drives the core's tap logic.
        onSelect={(_range, day) => {
          if (!isCheckingAvailability) core.selectDay(day);
        }}
        disabled={(day) => core.isDateDisabled(day) || Boolean(isProductUnavailable?.(day))}
        modifiers={{
          unavailable: (day) => Boolean(isProductUnavailable?.(day)),
          ...Object.fromEntries(
            seasonTones.map(([tone, seasons]) => [
              `season${tone}`,
              (day: Date) =>
                Boolean(findSeasonalPricingForDate(seasons, format(day, "yyyy-MM-dd"))),
            ]),
          ),
        }}
        modifiersClassNames={{
          unavailable: "line-through decoration-2",
          ...Object.fromEntries(
            seasonTones.map(([tone]) => [`season${tone}`, SEASON_DAY_CLASSES[tone]]),
          ),
        }}
        labels={
          seasonalPricing
            ? {
                labelDayButton: (day, modifiers, options) => {
                  const season = findSeasonalPricingForDate(
                    seasonalPricing.seasons,
                    format(day, "yyyy-MM-dd"),
                  );
                  return `${labelDayButton(day, modifiers, options)}, ${season?.name ?? ts("baseSeason")}, ${formatMoney(season?.basePrice ?? seasonalPricing.basePrice)} / ${formatPeriod(seasonalPricing.periodMinutes)}`;
                },
              }
            : undefined
        }
        month={month}
        onMonthChange={onMonthChange}
        defaultMonth={core.startDate ?? core.minDate}
        locale={dateLocale}
        density={variant === "sheet" ? "comfortable" : "default"}
        touchTarget={isPopover}
        autoFocus={isPopover}
        className={cn(!isPopover && "p-0")}
      />
      {isCheckingAvailability ? (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/70 backdrop-blur-[2px]"
        >
          <span className="flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm shadow-sm">
            <LoaderIcon aria-hidden className="size-4 motion-safe:animate-spin" />
            {t("availabilityChecking")}
          </span>
        </div>
      ) : null}
    </div>
  );

  const times = (
    <div
      className={cn(
        "grid grid-cols-2 gap-3",
        isPopover ? "items-center justify-between border-t pt-3" : "items-start",
      )}
    >
      <TimeSelectField
        id={`${fieldId}-start`}
        label={t("startLabel")}
        slots={core.startTimeSlots}
        value={core.startTime}
        onSelect={core.setStartTime}
        emptyMessage={closedMessage}
        disabled={!core.startDate && !allowTimeSelectionWithoutDates}
        layout={isPopover ? "inline" : "stacked"}
      />
      <TimeSelectField
        id={`${fieldId}-end`}
        label={t("endLabel")}
        slots={core.endTimeSlots}
        value={core.endTime}
        onSelect={core.setEndTime}
        emptyMessage={closedMessage}
        disabled={!core.endDate && !allowTimeSelectionWithoutDates}
        layout={isPopover ? "inline" : "stacked"}
        className={cn(isPopover && "justify-self-end")}
      />
    </div>
  );

  return (
    <div className={cn("flex flex-col", isPopover ? "gap-3" : "gap-4", className)}>
      {calendar}
      {visibleSeasonalPricing?.seasons.length ? (
        <SeasonalCalendarLegend pricing={visibleSeasonalPricing} />
      ) : null}
      {times}
      {message ? (
        <p role="status" className="text-xs text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
};
