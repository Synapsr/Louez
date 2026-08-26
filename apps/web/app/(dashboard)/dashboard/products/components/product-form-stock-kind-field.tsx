"use client";

import { useTranslations } from "next-intl";

import type { StockKind } from "@louez/types";
import { Label, Radio } from "@louez/ui";
import { cn } from "@louez/utils";

import type { ProductFormComponentApi, ProductFormValues } from "../types";

interface ProductFormStockKindFieldProps {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  disabled?: boolean;
}

/** Base UI radio groups hand back an `unknown` value; narrow it here. */
function toStockKind(value: unknown): StockKind {
  return value === "consumable" ? "consumable" : "returnable";
}

export const ProductFormStockKindField = ({
  form,
  watchedValues,
  disabled,
}: ProductFormStockKindFieldProps) => {
  const t = useTranslations("dashboard.products.form");

  // Server-side invariants: a consumable is always priced as a flat rate and
  // never tracked unit by unit. Rather than silently rewriting the rest of the
  // form, the option stays out of reach until both hold.
  const blockedByPricing = watchedValues.pricingKind !== "fixed";
  const blockedByUnitTracking = Boolean(watchedValues.trackUnits);
  const consumableDisabled = disabled || blockedByPricing || blockedByUnitTracking;

  const stockKindOptions: Array<{
    value: StockKind;
    label: string;
    description: string;
    disabled: boolean;
  }> = [
    {
      value: "returnable",
      label: t("stockKindReturnable"),
      description: t("stockKindReturnableDescription"),
      disabled: Boolean(disabled),
    },
    {
      value: "consumable",
      label: t("stockKindConsumable"),
      description: t("stockKindConsumableDescription"),
      disabled: consumableDisabled,
    },
  ];

  return (
    <form.Field name="stockKind">
      {(field) => (
        <form.RadioGroup
          label={t("stockKindLabel")}
          value={field.state.value ?? "returnable"}
          onValueChange={(value) => field.handleChange(toStockKind(value))}
          disabled={disabled}
          className="grid gap-3 sm:grid-cols-2"
          helpText={
            blockedByPricing
              ? t("stockKindConsumableRequiresFixed")
              : blockedByUnitTracking
                ? t("stockKindConsumableRequiresNoUnits")
                : undefined
          }
        >
          {stockKindOptions.map((option) => (
            <Label
              key={option.value}
              className={cn(
                "bg-background hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-background flex items-start gap-2 rounded-lg border p-3",
                option.disabled && "pointer-events-none opacity-64",
              )}
            >
              <Radio value={option.value} disabled={option.disabled} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{option.label}</p>
                <p className="text-muted-foreground mt-1 text-xs">{option.description}</p>
              </div>
            </Label>
          ))}
        </form.RadioGroup>
      )}
    </form.Field>
  );
};
