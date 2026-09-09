"use client";

import { useTranslations } from "next-intl";

import { InputQuantity, Label } from "@louez/ui";
import type { StockQuantityLimit } from "@louez/utils";

interface QuantityStepperProps {
  value: number;
  /** `null` when stock is not tracked. */
  max: StockQuantityLimit;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Replaces the default "N available" caption. */
  hint?: string;
}

/** Quantity row: label, 44 px stepper on phones, units left as a caption. */
export const QuantityStepper = ({ value, max, onChange, disabled, hint }: QuantityStepperProps) => {
  const t = useTranslations("storefront.product");
  const caption = hint ?? (max === null ? null : t("availableCount", { count: max }));

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label className="text-sm font-medium">{t("quantity")}</Label>
        {caption ? <span className="text-xs text-muted-foreground">{caption}</span> : null}
      </div>
      <InputQuantity
        value={value}
        onChange={onChange}
        min={1}
        max={max === null ? undefined : Math.max(1, max)}
        disabled={disabled}
        editable={false}
        ariaLabel={t("quantity")}
        className="max-sm:[&_[data-slot=button]]:size-11 max-sm:[&>div]:h-11"
      />
    </div>
  );
};
