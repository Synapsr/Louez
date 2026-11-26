"use client";

import { useCallback } from "react";

import { useTranslations } from "next-intl";

import type { PricingMode } from "@louez/types";

/**
 * How a pricing period reads: after a price ("12 €/d") and after a count
 * ("3 days"), in the dashboard's language.
 */
export function usePricingModeLabels() {
  const t = useTranslations("dashboard.reservations.manualForm");
  const tCommon = useTranslations("common");

  const perUnit = useCallback(
    (mode: PricingMode) => {
      if (mode === "hour") return t("perHour");
      if (mode === "week") return t("perWeek");
      return t("perDay");
    },
    [t],
  );

  const units = useCallback(
    (mode: PricingMode, count: number) => {
      if (mode === "hour") return tCommon("hourUnit", { count });
      if (mode === "week") return tCommon("weekUnit", { count });
      return tCommon("dayUnit", { count });
    },
    [tCommon],
  );

  return { perUnit, units };
}
