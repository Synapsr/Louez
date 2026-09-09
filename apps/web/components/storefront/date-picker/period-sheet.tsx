"use client";

import { useTranslations } from "next-intl";

import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "@louez/ui";

import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

import type { RentalPeriodValue } from "./core/types";
import { PeriodEditor } from "./period-editor";

interface PeriodSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: RentalPeriodValue | null;
  rules: RentalPeriodRules;
  minDate?: Date;
  title?: string;
  onApply: (period: RentalPeriodValue) => void;
}

/**
 * Bottom sheet on the phone (`Dialog` turns into a drawer under `sm`),
 * centered dialog above: range calendar with 44 px cells, time chips, live
 * summary and a "Valider" footer that clears the home indicator.
 */
export const PeriodSheet = ({
  open,
  onOpenChange,
  value,
  rules,
  minDate,
  title,
  onApply,
}: PeriodSheetProps) => {
  const t = useTranslations("storefront.dateSelection");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? t("modifyDates")}</DialogTitle>
        </DialogHeader>
        <PeriodEditor
          value={value}
          rules={rules}
          minDate={minDate}
          variant="sheet"
          onApply={(period) => {
            onApply(period);
            onOpenChange(false);
          }}
        />
      </DialogPopup>
    </Dialog>
  );
};
