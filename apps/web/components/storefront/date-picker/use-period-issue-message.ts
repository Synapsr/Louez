"use client";

import { useTranslations } from "next-intl";

import type { RentalPeriodValidation } from "@/lib/utils/util.rental-period";

/**
 * One short line per failing rule. `missing_dates` returns null: an empty
 * picker is not an error, the CTA simply opens it.
 */
export const usePeriodIssueMessage = () => {
  const t = useTranslations("storefront.dateSelection.errors");

  return (validation: RentalPeriodValidation): string | null => {
    if (validation.ok) return null;
    const { issue } = validation;
    switch (issue.code) {
      case "missing_dates":
        return null;
      case "end_before_start":
        return t("endBeforeStart");
      case "same_day_not_allowed":
        return t("sameDayNotAllowed");
      case "business_hours":
        return t("businessHours");
      case "advance_notice":
        return t("advanceNotice", { duration: issue.duration });
      case "min_duration":
        return t("minDuration", { duration: issue.duration });
      case "max_duration":
        return t("maxDuration", { duration: issue.duration });
    }
  };
};
