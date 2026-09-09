"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import type { BusinessHours } from "@louez/types";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { RentalPeriodPicker } from "@/components/storefront/date-picker/rental-period-picker";
import { useCart } from "@/contexts/cart-context";
import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import type { PricingMode } from "@/lib/utils/duration";
import { parseRentalPeriod, type RentalPeriodRules } from "@/lib/utils/util.rental-period";

interface DatePickerModalProps {
  storeSlug: string;
  pricingMode: PricingMode;
  businessHours?: BusinessHours;
  advanceNotice?: number;
  minRentalMinutes?: number;
  maxRentalMinutes?: number | null;
  timezone?: string;
  isOpen: boolean;
  onClose: () => void;
  initialStartDate?: string;
  initialEndDate?: string;
  redirectOnSubmit?: boolean;
}

/** "Modifier les dates" sheet used by the checkout and the dated catalog. */
export const DatePickerModal = ({
  storeSlug,
  pricingMode,
  businessHours,
  advanceNotice = 0,
  minRentalMinutes = 60,
  maxRentalMinutes = null,
  timezone,
  isOpen,
  onClose,
  initialStartDate,
  initialEndDate,
  redirectOnSubmit = true,
}: DatePickerModalProps) => {
  const router = useRouter();
  const { setGlobalDates, setPricingMode } = useCart();
  const { getUrl } = useStorefrontUrl(storeSlug);

  const value = useMemo(
    () => parseRentalPeriod(initialStartDate, initialEndDate),
    [initialStartDate, initialEndDate],
  );

  const rules = useMemo<RentalPeriodRules>(
    () => ({
      pricingMode,
      businessHours,
      timezone,
      advanceNoticeMinutes: advanceNotice,
      minRentalMinutes,
      maxRentalMinutes,
    }),
    [pricingMode, businessHours, timezone, advanceNotice, minRentalMinutes, maxRentalMinutes],
  );

  const apply = (period: RentalPeriodValue) => {
    const start = period.start.toISOString();
    const end = period.end.toISOString();
    setPricingMode(pricingMode);
    setGlobalDates(start, end);
    if (redirectOnSubmit) {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      router.push(`${getUrl("/catalog")}?${params.toString()}`);
    }
  };

  return (
    <RentalPeriodPicker
      layout="sheet"
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      value={value}
      onChange={apply}
      rules={rules}
    />
  );
};
