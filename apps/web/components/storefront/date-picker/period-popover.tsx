"use client";

import type { SeasonalCalendarPricing } from "@/lib/utils/util.storefront-seasonal-pricing";

import { useContext, type ReactNode } from "react";

import { Popover, PopoverPopup } from "@louez/ui";

import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

import type { RentalPeriodField, RentalPeriodValue } from "./core/types";
import { PeriodInteractionContext } from "./period-interaction-context";
import { PeriodEditor } from "./period-editor";

interface PeriodPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: RentalPeriodValue | null;
  seasonalPricing?: SeasonalCalendarPricing;
  initialField?: RentalPeriodField;
  rules: RentalPeriodRules;
  minDate?: Date;
  onApply: (period: RentalPeriodValue) => void;
  /** The trigger: a `PopoverTrigger` (or a chip rendering one). */
  children: ReactNode;
}

/** Desktop surface: calendar plus two slot lists in one popover. */
export const PeriodPopover = ({
  open,
  onOpenChange,
  value,
  seasonalPricing,
  initialField,
  rules,
  minDate,
  onApply,
  children,
}: PeriodPopoverProps) => {
  const { autoFocus } = useContext(PeriodInteractionContext);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {children}
      <PopoverPopup
        initialFocus={autoFocus}
        finalFocus={autoFocus}
        align="start"
        animateContent={false}
        className="w-auto max-w-[calc(100vw-2rem)] shadow-raised"
      >
        <PeriodEditor
          seasonalPricing={seasonalPricing}
          value={value}
          initialField={initialField}
          rules={rules}
          minDate={minDate}
          variant="popover"
          onApply={(period) => {
            onApply(period);
            onOpenChange(false);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
};
