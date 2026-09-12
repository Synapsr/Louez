"use client";

import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { usePricingNow } from "@/hooks/use-pricing-now";
import { CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";

import type { ProductPromotion } from "@louez/types";
import { Badge, Button, Calendar, Popover, PopoverPopup, PopoverTrigger } from "@louez/ui";
import { getProductPromotionStatus } from "@louez/utils";

import { useFormatLocale } from "@/hooks/use-format-locale";
import { pickPromotionDay, promotionDayToDate } from "@/lib/utils/util.promotion-dates";

interface ProductPromotionDatesProps {
  promotion: ProductPromotion;
  timezone: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (promotion: ProductPromotion) => void;
}

/**
 * Most offers run until removed, so the dates stay behind a chip that reads
 * back the period and its status, and opens a calendar when clicked.
 */
export const ProductPromotionDates = ({
  promotion,
  timezone,
  disabled,
  invalid,
  onChange,
}: ProductPromotionDatesProps) => {
  const t = useTranslations("dashboard.products.form.promotion");
  const { dateFns: dateLocale } = useFormatLocale();
  const now = usePricingNow();
  const today = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const status = getProductPromotionStatus(promotion, timezone, now);
  const { startsOn, endsOn } = promotion;
  const hasDates = Boolean(startsOn || endsOn);

  const formatDay = (day: string) =>
    format(
      promotionDayToDate(day),
      day.slice(0, 4) === today.slice(0, 4) ? "d MMM" : "d MMM yyyy",
      {
        locale: dateLocale,
      },
    );

  const period =
    startsOn && endsOn
      ? `${formatDay(startsOn)} → ${formatDay(endsOn)}`
      : startsOn
        ? t("from", { date: formatDay(startsOn) })
        : endsOn
          ? t("until", { date: formatDay(endsOn) })
          : t("schedule");

  const hint = !hasDates ? t("pickStart") : startsOn && !endsOn ? t("pickEnd") : null;

  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant={hasDates ? "outline" : "ghost"}
            size="sm"
            aria-invalid={invalid}
            className={hasDates ? "tabular-nums" : "text-muted-foreground"}
          />
        }
      >
        <CalendarClock />
        {period}
        {hasDates && (status === "scheduled" || status === "expired") && (
          <Badge variant={status === "scheduled" ? "info" : "expired"} size="sm">
            {t(status)}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-auto">
        {/* `w-min` pins the width to the calendar, so the footer wraps instead of resizing the popup. */}
        <div className="flex w-min flex-col">
          <Calendar
            mode="range"
            selected={{
              from: startsOn ? promotionDayToDate(startsOn) : undefined,
              to: endsOn ? promotionDayToDate(endsOn) : undefined,
            }}
            onSelect={(_, day) =>
              onChange({ ...promotion, ...pickPromotionDay(promotion, format(day, "yyyy-MM-dd")) })
            }
            defaultMonth={promotionDayToDate(startsOn ?? endsOn ?? today)}
            today={promotionDayToDate(today)}
            locale={dateLocale}
          />
          {(hint || hasDates) && (
            <div className="flex min-h-8 items-center justify-between gap-3 border-t px-2 pt-2">
              {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
              {hasDates && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="ml-auto"
                  onClick={() => onChange({ ...promotion, startsOn: null, endsOn: null })}
                >
                  {t("clearDates")}
                </Button>
              )}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
};
