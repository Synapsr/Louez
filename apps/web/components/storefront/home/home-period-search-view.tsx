"use client";

import { cn } from "@louez/utils";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { RentalPeriodPicker } from "@/components/storefront/date-picker/rental-period-picker";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

interface HomePeriodSearchViewProps {
  rules: RentalPeriodRules;
  tone?: "floating" | "flat";
  value: RentalPeriodValue | null;
  onChange: (period: RentalPeriodValue) => void;
  onSubmit: (period: RentalPeriodValue) => void;
}

const TONE_CLASS_NAMES = {
  floating: "shadow-overlay",
  flat: "border",
};

/** The hero's real search surface, with cart persistence and routing supplied by its caller. */
export const HomePeriodSearchView = ({
  rules,
  tone = "floating",
  value,
  onChange,
  onSubmit,
}: HomePeriodSearchViewProps) => (
  <div
    className={cn(
      "w-full max-w-2xl rounded-2xl bg-card p-4 text-card-foreground sm:p-5",
      TONE_CLASS_NAMES[tone],
    )}
    data-slot="home-period-search"
  >
    <RentalPeriodPicker
      layout="inline"
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      rules={rules}
      showTimezoneNotice
    />
  </div>
);
