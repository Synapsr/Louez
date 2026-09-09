"use client";

import { useTranslations } from "next-intl";

import { Button, DialogFooter, DialogPanel } from "@louez/ui";
import { cn } from "@louez/utils";

import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

import type { RentalPeriodValue } from "./core/types";
import { useRentalDateCore } from "./core/use-rental-date-core";
import { PeriodPanel, type PeriodPanelVariant } from "./period-panel";
import { PeriodSummary } from "./period-summary";

interface PeriodEditorProps {
  /** The committed period the draft starts from. */
  value: RentalPeriodValue | null;
  rules: RentalPeriodRules;
  variant: PeriodPanelVariant;
  /** Months side by side; the panel's default per variant when absent. */
  months?: 1 | 2;
  /** Extra calendar floor for callers that only know a minimum date. */
  minDate?: Date;
  onApply: (period: RentalPeriodValue) => void;
  className?: string;
}

/**
 * Owns the draft (`useRentalDateCore`) for one open surface and commits it
 * with "Valider". Mounted when the surface opens, so every opening starts
 * from the committed value.
 */
export const PeriodEditor = ({
  value,
  rules,
  variant,
  months,
  minDate,
  onApply,
  className,
}: PeriodEditorProps) => {
  const t = useTranslations("storefront.dateSelection");
  const core = useRentalDateCore({
    initialStart: value?.start,
    initialEnd: value?.end,
    pricingMode: rules.pricingMode,
    minRentalMinutes: rules.minRentalMinutes ?? 60,
    maxRentalMinutes: rules.maxRentalMinutes,
    businessHours: rules.businessHours,
    advanceNoticeMinutes: rules.advanceNoticeMinutes,
    minDate,
    timezone: rules.timezone,
  });

  const handleApply = () => {
    const range = core.buildFinalRange();
    if (range) onApply(range);
  };

  if (variant === "sheet") {
    return (
      <>
        <DialogPanel className={className}>
          <PeriodPanel core={core} variant="sheet" months={months} />
        </DialogPanel>
        <DialogFooter variant="bare" className="sm:flex-col-reverse sm:items-stretch">
          <Button size="xl" className="w-full" onClick={handleApply} disabled={!core.canSubmit}>
            {t("validate")}
          </Button>
          <PeriodSummary period={core.period} timezone={rules.timezone} />
        </DialogFooter>
      </>
    );
  }

  return (
    <div className={cn("flex flex-col", variant === "embed" ? "gap-3" : "gap-3 p-3", className)}>
      <PeriodPanel core={core} variant={variant} months={months} />
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <PeriodSummary
          period={core.period}
          timezone={rules.timezone}
          className="min-w-0 truncate"
        />
        <Button
          size={variant === "embed" ? "sm" : "default"}
          onClick={handleApply}
          disabled={!core.canSubmit}
        >
          {t("validate")}
        </Button>
      </div>
    </div>
  );
};
