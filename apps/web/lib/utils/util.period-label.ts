import { minutesToPriceDuration } from "@louez/utils";

/** The translator a period label needs: next-intl's `t`, client or server, unscoped. */
export type PeriodLabelTranslator = (key: string, values?: { count: number }) => string;

export interface PeriodLabelOptions {
  /** Keep the leading "1" ("1 heure"), for list rows next to "3 heures". */
  alwaysShowCount?: boolean;
}

/**
 * A rental period given in minutes, in words: "1 heure", "3 jours",
 * "45 minutes". Without `alwaysShowCount`, a single unit reads "heure".
 */
export const formatPeriodLabel = (
  t: PeriodLabelTranslator,
  periodMinutes: number,
  options?: PeriodLabelOptions,
): string => {
  const period = minutesToPriceDuration(periodMinutes);
  const alwaysShowCount = options?.alwaysShowCount ?? false;
  const unitLabel =
    period.unit === "minute"
      ? t("common.minuteUnit", { count: period.duration })
      : t(
          `storefront.product.pricingUnit.${period.unit}.${period.duration === 1 ? "singular" : "plural"}`,
        );

  return period.duration === 1 && !alwaysShowCount ? unitLabel : `${period.duration} ${unitLabel}`;
};
