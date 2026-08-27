"use client";

import { useTranslations } from "next-intl";

import type { StockKind } from "@louez/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@louez/ui";

import type { ProductFormComponentApi, ProductFormValues } from "../types";

interface ProductFormStockKindFieldProps {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  disabled?: boolean;
  stockKindChangeBlocked?: boolean;
  ariaDescribedBy?: string;
}

/** Base UI selects hand back an `unknown` value; narrow it here. */
function toStockKind(value: unknown): StockKind {
  return value === "consumable" ? "consumable" : "returnable";
}

/**
 * Compact stock-kind selector meant for the Stock card header: the choice is
 * made once, so it does not deserve a block of radio cards in the body.
 */
export const ProductFormStockKindField = ({
  form,
  watchedValues,
  disabled,
  stockKindChangeBlocked = false,
  ariaDescribedBy,
}: ProductFormStockKindFieldProps) => {
  const t = useTranslations("dashboard.products.form");

  // Server-side invariants: a consumable is always priced as a flat rate and
  // never tracked unit by unit. Rather than silently rewriting the rest of the
  // form, the option stays out of reach until both hold.
  const blockedByPricing = watchedValues.pricingKind !== "fixed";
  const blockedByUnitTracking = Boolean(watchedValues.trackUnits);
  const consumableDisabled = disabled || blockedByPricing || blockedByUnitTracking;
  // The reason lives inside the disabled option itself: visible exactly when
  // the user opens the menu and wonders why "Consumable" is out of reach.
  const blockedHint = blockedByPricing
    ? t("stockKindConsumableRequiresFixed")
    : blockedByUnitTracking
      ? t("stockKindConsumableRequiresNoUnits")
      : null;

  return (
    <form.Field name="stockKind">
      {(field) => (
        <Select
          value={field.state.value ?? "returnable"}
          onValueChange={(value) => field.handleChange(toStockKind(value))}
          disabled={disabled || stockKindChangeBlocked}
        >
          <SelectTrigger
            className="h-8 w-auto min-w-36"
            aria-label={t("stockKindLabel")}
            aria-describedby={ariaDescribedBy}
          >
            <SelectValue>
              {(field.state.value ?? "returnable") === "consumable"
                ? t("stockKindConsumable")
                : t("stockKindReturnable")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="returnable" label={t("stockKindReturnable")}>
              {t("stockKindReturnable")}
            </SelectItem>
            <SelectItem
              value="consumable"
              label={t("stockKindConsumable")}
              disabled={consumableDisabled}
            >
              <span className="flex flex-col items-start">
                <span>{t("stockKindConsumable")}</span>
                {consumableDisabled && blockedHint ? (
                  <span className="text-muted-foreground text-xs">
                    {blockedHint}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      )}
    </form.Field>
  );
};
