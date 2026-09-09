"use client";

import { useCallback } from "react";

import { useTranslations } from "next-intl";

import { minutesToPriceDuration } from "@louez/utils";

/**
 * Formats a rental period given in minutes — "1 heure", "3 jours", "45 minutes".
 *
 * `alwaysShowCount` keeps the leading "1" for list rows, where a bare
 * "heure" next to "3 heures" reads as a missing number.
 */
export const usePeriodLabel = () => {
  const t = useTranslations();

  return useCallback(
    (periodMinutes: number, options?: { alwaysShowCount?: boolean }) => {
      const period = minutesToPriceDuration(periodMinutes);
      const alwaysShowCount = options?.alwaysShowCount ?? false;
      const unitLabel =
        period.unit === "minute"
          ? t("common.minuteUnit", { count: period.duration })
          : t(
              `storefront.product.pricingUnit.${period.unit}.${period.duration === 1 ? "singular" : "plural"}`,
            );

      return period.duration === 1 && !alwaysShowCount
        ? unitLabel
        : `${period.duration} ${unitLabel}`;
    },
    [t],
  );
};
