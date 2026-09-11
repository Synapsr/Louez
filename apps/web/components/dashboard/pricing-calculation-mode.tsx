"use client";

import { useId } from "react";
import { useLocale, useTranslations } from "next-intl";

import type { Rate } from "@louez/types";
import { Label, Radio, RadioGroup } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import {
  formatPricingPreviewDuration,
  getPricingCalculationPreview,
} from "./util.pricing-calculation-preview";

interface PricingCalculationModeProps {
  basePrice: number;
  basePeriodMinutes: number;
  rates: Rate[];
  enforceStrictTiers: boolean;
  onChange: (enforceStrictTiers: boolean) => void;
  currency: string;
  disabled: boolean;
}

export const PricingCalculationMode = ({
  basePrice,
  basePeriodMinutes,
  rates,
  enforceStrictTiers,
  onChange,
  currency,
  disabled,
}: PricingCalculationModeProps) => {
  const t = useTranslations("dashboard.products.form.calculationMode");
  const locale = useLocale();
  const id = useId();
  const preview = getPricingCalculationPreview(
    basePrice,
    basePeriodMinutes,
    rates,
    enforceStrictTiers,
  );

  return (
    <fieldset className="mb-5 space-y-3" disabled={disabled}>
      <legend id={id} className="text-sm font-medium">
        {t("label")}
      </legend>
      <RadioGroup
        aria-labelledby={id}
        value={enforceStrictTiers ? "whole" : "prorated"}
        onValueChange={(value) => onChange(value === "whole")}
        disabled={disabled}
        className="grid gap-2 sm:grid-cols-2"
      >
        {(["whole", "prorated"] as const).map((mode) => (
          <Label
            key={mode}
            htmlFor={`${id}-${mode}`}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50 has-data-disabled:cursor-default has-data-disabled:opacity-60"
          >
            <Radio
              id={`${id}-${mode}`}
              value={mode}
              aria-labelledby={`${id}-${mode}-label`}
              aria-describedby={`${id}-${mode}-description`}
              className="mt-0.5"
            />
            <span className="min-w-0 space-y-1">
              <span id={`${id}-${mode}-label`} className="block text-sm font-medium">
                {t(`${mode}.label`)}
              </span>
              <span
                id={`${id}-${mode}-description`}
                className="text-muted-foreground block text-xs leading-relaxed"
              >
                {t(`${mode}.${rates.length > 0 ? "tiersDescription" : "description"}`)}
              </span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      <div className="space-y-1" aria-live="polite" aria-atomic="true">
        <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">
            {t("example", {
              duration: formatPricingPreviewDuration(preview.durationMinutes, locale),
            })}
          </span>
          <span className="font-medium tabular-nums">
            {formatCurrency(preview.subtotal, currency, locale)}
          </span>
        </p>
        <p className="text-muted-foreground text-xs">
          {t("minimum", {
            price: formatCurrency(basePrice, currency, locale),
            duration: formatPricingPreviewDuration(basePeriodMinutes, locale),
          })}
        </p>
      </div>
    </fieldset>
  );
};
