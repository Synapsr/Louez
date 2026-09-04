"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import type { StockKindChangeBlocker } from "@louez/db";
import type { StockKind } from "@louez/types";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@louez/ui";
import { ArrowRightIcon, ChevronsUpDownIcon } from "@louez/ui/icons";

import { getReservationDetailHref } from "@/lib/product-analytics/reservation-analytics";

import type { ProductFormComponentApi, ProductFormValues } from "../types";

interface ProductFormStockKindFieldProps {
  form: ProductFormComponentApi;
  productId?: string;
  watchedValues: ProductFormValues;
  disabled?: boolean;
  stockKindChangeBlockers?: StockKindChangeBlocker[];
}

/** Base UI selects hand back an `unknown` value; narrow it here. */
function toStockKind(value: unknown): StockKind {
  if (value === "consumable" || value === "untracked") {
    return value;
  }
  return "returnable";
}

/**
 * Compact stock-kind selector meant for the Stock card header: the choice is
 * made once, so it does not deserve a block of radio cards in the body.
 */
export const ProductFormStockKindField = ({
  form,
  productId,
  watchedValues,
  disabled,
  stockKindChangeBlockers = [],
}: ProductFormStockKindFieldProps) => {
  const t = useTranslations("dashboard.products.form");

  // Server-side invariants: a consumable is always priced as a flat rate and
  // never tracked unit by unit. Rather than silently rewriting the rest of the
  // form, the option stays out of reach until both hold.
  const blockedByPricing = watchedValues.pricingKind !== "fixed";
  const blockedByUnitTracking = Boolean(watchedValues.trackUnits);
  const consumableDisabled = disabled || blockedByPricing || blockedByUnitTracking;
  const untrackedDisabled = disabled || blockedByUnitTracking;
  // The reason lives inside the disabled option itself: visible exactly when
  // the user opens the menu and wonders why "Consumable" is out of reach.
  const blockedHint = blockedByPricing
    ? t("stockKindConsumableRequiresFixed")
    : blockedByUnitTracking
      ? t("stockKindConsumableRequiresNoUnits")
      : null;

  return (
    <form.Field name="stockKind">
      {(field) => {
        const stockKind = field.state.value ?? "returnable";
        const stockKindLabel =
          stockKind === "consumable"
            ? t("stockKindConsumable")
            : stockKind === "untracked"
              ? t("stockKindUntracked")
              : t("stockKindReturnable");

        if (stockKindChangeBlockers.length > 0) {
          return (
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-w-36 justify-between text-sm font-normal"
                    disabled={disabled}
                    aria-label={t("stockKindChangeBlockedTrigger", { kind: stockKindLabel })}
                  />
                }
              >
                {stockKindLabel}
                <ChevronsUpDownIcon data-slot="icon" className="text-muted-foreground" />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <div className="space-y-3 p-2">
                  <div className="space-y-1">
                    <PopoverTitle className="text-sm">
                      {t("stockKindChangeBlockedTitle")}
                    </PopoverTitle>
                    <PopoverDescription className="text-xs">
                      {t("stockKindChangeBlocked")}
                    </PopoverDescription>
                  </div>
                  <ul className="space-y-1">
                    {stockKindChangeBlockers.map((reservation) => (
                      <li key={reservation.id}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-between"
                          render={
                            <Link
                              href={getReservationDetailHref(
                                reservation.id,
                                "product_detail",
                                productId ? `/dashboard/products/${productId}/edit` : undefined,
                              )}
                            />
                          }
                        >
                          {t("stockKindBlockingReservation", {
                            number: reservation.number,
                          })}
                          <ArrowRightIcon data-slot="icon" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              </PopoverContent>
            </Popover>
          );
        }

        return (
          <Select
            value={stockKind}
            onValueChange={(value) => field.handleChange(toStockKind(value))}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-auto min-w-36" aria-label={t("stockKindLabel")}>
              <SelectValue>{stockKindLabel}</SelectValue>
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
                    <span className="text-muted-foreground text-xs">{blockedHint}</span>
                  ) : null}
                </span>
              </SelectItem>
              <SelectItem
                value="untracked"
                label={t("stockKindUntracked")}
                disabled={untrackedDisabled}
              >
                <span className="flex flex-col items-start">
                  <span>{t("stockKindUntracked")}</span>
                  {blockedByUnitTracking ? (
                    <span className="text-muted-foreground text-xs">
                      {t("stockKindUntrackedRequiresNoUnits")}
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        );
      }}
    </form.Field>
  );
};
