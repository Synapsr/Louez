"use client";

import type { SeasonalCalendarPricing } from "@/lib/utils/util.storefront-seasonal-pricing";

import type { Ref } from "react";

import { useTranslations } from "next-intl";

import { Label } from "@louez/ui";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { RentalPeriodPicker } from "@/components/storefront/date-picker/rental-period-picker";

import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

interface BookingPeriodFieldProps {
  value: RentalPeriodValue | null;
  onChange: (period: RentalPeriodValue) => void;
  /** Controlled picker visibility: the CTA opens it when no dates are set. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: RentalPeriodRules;
  seasonalPricing?: SeasonalCalendarPricing;
  ref?: Ref<HTMLDivElement>;
}

/**
 * The period row of the booking panel: the shared picker in its inline
 * layout (two fields; a sheet on phones, a popover above), prefilled with
 * the cart's period.
 */
export const BookingPeriodField = ({
  value,
  onChange,
  open,
  onOpenChange,
  rules,
  seasonalPricing,
  ref,
}: BookingPeriodFieldProps) => {
  const t = useTranslations("storefront.product");

  return (
    <div ref={ref} className="flex scroll-mt-24 flex-col gap-1.5">
      <Label className="text-sm font-medium">{t("booking.dates")}</Label>
      <RentalPeriodPicker
        seasonalPricing={seasonalPricing}
        layout="inline"
        value={value}
        onChange={onChange}
        open={open}
        onOpenChange={onOpenChange}
        rules={rules}
      />
    </div>
  );
};
