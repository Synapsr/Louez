"use client";

import { useState } from "react";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button, Popover, PopoverPopup, PopoverTrigger } from "@louez/ui";

import {
  FinancesMoreFiltersForm,
  type FinancesMoreFiltersValue,
} from "./finances-more-filters-form";

interface FinancesMoreFiltersProps {
  value: FinancesMoreFiltersValue;
  activeCount: number;
  onApply: (value: FinancesMoreFiltersValue) => void;
}

/** The filters used once in a while stay behind one button, so the row keeps three controls. */
export const FinancesMoreFilters = ({ value, activeCount, onApply }: FinancesMoreFiltersProps) => {
  const t = useTranslations("dashboard.finances.filters");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" />}>
        <SlidersHorizontal />
        {t("more")}
        {activeCount > 0 && (
          <Badge variant="progress" size="sm">
            {activeCount}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-80">
        {/* Mounted with the popup: each opening starts from the filters in the URL. */}
        <FinancesMoreFiltersForm
          value={value}
          onApply={(nextValue) => {
            onApply(nextValue);
            setOpen(false);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
};
