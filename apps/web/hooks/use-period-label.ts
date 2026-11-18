"use client";

import { useCallback } from "react";

import { useTranslations } from "next-intl";

import { formatPeriodLabel, type PeriodLabelOptions } from "@/lib/utils/util.period-label";

/**
 * Formats a rental period given in minutes — "1 heure", "3 jours", "45 minutes".
 * See `formatPeriodLabel`.
 */
export const usePeriodLabel = () => {
  const t = useTranslations();

  return useCallback(
    (periodMinutes: number, options?: PeriodLabelOptions) =>
      formatPeriodLabel(t, periodMinutes, options),
    [t],
  );
};
