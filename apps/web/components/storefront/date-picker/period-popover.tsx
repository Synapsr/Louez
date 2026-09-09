"use client";

import type { ReactNode } from "react";

import { Popover, PopoverPopup } from "@louez/ui";

import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

import type { RentalPeriodValue } from "./core/types";
import { PeriodEditor } from "./period-editor";

interface PeriodPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: RentalPeriodValue | null;
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
  rules,
  minDate,
  onApply,
  children,
}: PeriodPopoverProps) => (
  <Popover open={open} onOpenChange={onOpenChange}>
    {children}
    <PopoverPopup align="start" className="w-auto max-w-[calc(100vw-2rem)] shadow-raised">
      <PeriodEditor
        value={value}
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
