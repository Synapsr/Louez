"use client";

import { useTranslations } from "next-intl";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";
import { FINANCE_PERIODS, MAX_FINANCE_RANGE_DAYS, type FinancePeriod } from "@louez/utils";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { DayRange } from "@/lib/utils/util.day-range";

interface FinancesPeriodControlProps {
  period: FinancePeriod;
  /** The days the server resolved the period to: what a custom range starts from. */
  range: DayRange;
  today: string;
  onPeriodChange: (period: FinancePeriod, range: DayRange | null) => void;
}

const isFinancePeriod = (value: string): value is FinancePeriod =>
  FINANCE_PERIODS.some((period) => period === value);

export const FinancesPeriodControl = ({
  period,
  range,
  today,
  onPeriodChange,
}: FinancesPeriodControlProps) => {
  const t = useTranslations("dashboard.finances.period");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={period}
        onValueChange={(value) => {
          if (value === null || !isFinancePeriod(value)) return;
          // Going custom keeps the days on screen, so the view does not jump
          // before the first range is picked.
          onPeriodChange(value, value === "custom" ? range : null);
        }}
      >
        <SelectTrigger className="w-full sm:w-44" aria-label={t("label")}>
          <SelectValue>{t(period)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {FINANCE_PERIODS.map((option) => (
            <SelectItem key={option} value={option} label={t(option)}>
              {t(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {period === "custom" && (
        <DateRangePicker
          value={range}
          onChange={(nextRange) => onPeriodChange("custom", nextRange)}
          today={today}
          maxDay={today}
          maxDays={MAX_FINANCE_RANGE_DAYS}
          aria-label={t("custom")}
          className="w-full sm:w-auto"
        />
      )}
    </div>
  );
};
