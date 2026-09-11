"use client";

import type { SeasonalCalendarPricing } from "@/lib/utils/util.storefront-seasonal-pricing";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";

import { useTranslations } from "next-intl";

import { Button, DialogFooter, DialogPanel } from "@louez/ui";
import { cn } from "@louez/utils";

import { type RentalPeriodRules } from "@/lib/utils/util.rental-period";
import { storefrontQueries } from "@/lib/queries/storefront.queries";

import type { RentalPeriodField, RentalPeriodValue } from "./core/types";
import { useRentalDateCore } from "./core/use-rental-date-core";
import { PeriodPanel, type PeriodPanelVariant } from "./period-panel";
import { PeriodSummary } from "./period-summary";
import { buildCalendarAvailabilityCandidates } from "./util.calendar-availability";

interface PeriodEditorProps {
  /** The committed period the draft starts from. */
  value: RentalPeriodValue | null;
  seasonalPricing?: SeasonalCalendarPricing;
  initialField?: RentalPeriodField;
  rules: RentalPeriodRules;
  variant: PeriodPanelVariant;
  /** Months side by side; the panel's default per variant when absent. */
  months?: 1 | 2;
  /** Extra calendar floor for callers that only know a minimum date. */
  minDate?: Date;
  onApply: (period: RentalPeriodValue) => void;
  className?: string;
  productId?: string;
}

/**
 * Owns the draft (`useRentalDateCore`) for one open surface and commits it
 * with "Valider". Mounted when the surface opens, so every opening starts
 * from the committed value.
 */
export const PeriodEditor = ({
  value,
  seasonalPricing,
  initialField,
  rules,
  variant,
  months,
  minDate,
  onApply,
  className,
  productId,
}: PeriodEditorProps) => {
  const t = useTranslations("storefront.dateSelection");
  const core = useRentalDateCore({
    initialStart: value?.start,
    initialEnd: value?.end,
    initialField,
    pricingMode: rules.pricingMode,
    minRentalMinutes: rules.minRentalMinutes ?? 60,
    maxRentalMinutes: rules.maxRentalMinutes,
    businessHours: rules.businessHours,
    advanceNoticeMinutes: rules.advanceNoticeMinutes,
    minDate,
    timezone: rules.timezone,
  });

  const [month, setMonth] = useState(() =>
    startOfMonth((initialField === "end" ? core.endDate : core.startDate) ?? core.minDate),
  );
  const candidates = useMemo(
    () =>
      productId
        ? buildCalendarAvailabilityCandidates({
            core,
            rules,
            month,
            months: months ?? (variant === "popover" ? 2 : 1),
          })
        : [],
    [productId, core, rules, month, months, variant],
  );
  const calendar = useQuery({
    ...storefrontQueries.calendar({
      productId: productId ?? "",
      periods: candidates.map(({ startDate, endDate }) => ({ startDate, endDate })),
    }),
    enabled: Boolean(productId) && candidates.length > 0,
  });
  const availability = useQuery({
    ...storefrontQueries.availability({
      productIds: productId ? [productId] : [],
      startDate: core.period?.start.toISOString() ?? "",
      endDate: core.period?.end.toISOString() ?? "",
    }),
    enabled: Boolean(productId) && core.canSubmit,
  });
  const availableProduct = availability.data?.products.find(
    (entry) => entry.productId === productId,
  );
  const canSubmit =
    core.canSubmit &&
    (!productId ||
      (!availability.isFetching &&
        !availability.isError &&
        Boolean(availableProduct) &&
        availableProduct?.availableQuantity !== 0 &&
        availability.data?.businessHoursValidation?.valid !== false &&
        availability.data?.advanceNoticeValidation?.valid !== false));
  const unavailableDays = new Set(
    candidates
      .filter((_, index) => calendar.data?.[index]?.available === false)
      .map(({ day }) => day),
  );
  const isProductUnavailable = productId
    ? (day: Date) => unavailableDays.has(format(day, "yyyy-MM-dd"))
    : undefined;
  const checking =
    Boolean(productId) && (calendar.isFetching || (core.canSubmit && availability.isFetching));
  const failed =
    Boolean(productId) && (calendar.isError || (core.canSubmit && availability.isError));
  const unavailable =
    Boolean(productId) &&
    core.canSubmit &&
    !availability.isPending &&
    !availability.isFetching &&
    !availability.isError &&
    !canSubmit;
  const availabilityStatus =
    productId && (failed || unavailable) ? (
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {failed ? (
          <button
            type="button"
            className="underline"
            onClick={() => {
              void calendar.refetch();
              if (core.canSubmit) void availability.refetch();
            }}
          >
            {t("availabilityRetry")}
          </button>
        ) : (
          t("availabilityUnavailable")
        )}
      </div>
    ) : null;
  const panel = (
    <PeriodPanel
      seasonalPricing={seasonalPricing}
      core={core}
      isCheckingAvailability={checking}
      variant={variant}
      months={months}
      month={month}
      onMonthChange={setMonth}
      isProductUnavailable={isProductUnavailable}
      allowTimeSelectionWithoutDates={Boolean(productId)}
    />
  );

  const handleApply = () => {
    const range = core.buildFinalRange();
    if (range && canSubmit) onApply(range);
  };

  if (variant === "sheet") {
    return (
      <>
        <DialogPanel className={className}>
          {panel}
          {availabilityStatus}
        </DialogPanel>
        <DialogFooter variant="bare" className="sm:flex-col-reverse sm:items-stretch">
          <Button size="xl" className="w-full" onClick={handleApply} disabled={!canSubmit}>
            {t("validate")}
          </Button>
          <PeriodSummary period={core.period} timezone={rules.timezone} />
        </DialogFooter>
      </>
    );
  }

  return (
    <div className={cn("flex flex-col", variant === "embed" ? "gap-3" : "gap-3 p-3", className)}>
      {panel}
      {availabilityStatus}
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <PeriodSummary
          period={core.period}
          timezone={rules.timezone}
          className="min-w-0 truncate"
        />
        <Button
          size={variant === "embed" ? "sm" : "default"}
          onClick={handleApply}
          disabled={!canSubmit}
        >
          {t("validate")}
        </Button>
      </div>
    </div>
  );
};
