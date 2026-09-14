import type { StoreSettings } from "@louez/types";

import { getMinRentalMinutes } from "@/lib/utils/rental-duration";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

/**
 * The period rules of a store for every picker (header chip, catalogue,
 * product page): opening hours, notice, minimum and maximum duration.
 * Store entries price by the day (`pricingMode` is fixed to `day`).
 */
export const getStorePeriodRules = (
  settings: Partial<StoreSettings> | null | undefined,
): RentalPeriodRules => ({
  pricingMode: "day",
  businessHours: settings?.businessHours,
  timezone: settings?.timezone,
  advanceNoticeMinutes: settings?.advanceNoticeMinutes ?? 0,
  minRentalMinutes: getMinRentalMinutes(settings),
  maxRentalMinutes: settings?.maxRentalMinutes ?? null,
});
