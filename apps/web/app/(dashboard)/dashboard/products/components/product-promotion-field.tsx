"use client";

import { useState } from "react";

import { Plus, Tag, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { usePricingNow } from "@/hooks/use-pricing-now";
import { Button, Input, Label } from "@louez/ui";
import { applyProductPromotion, cn, getProductPromotionStatus } from "@louez/utils";

import { useFormatMoney } from "@/hooks/use-format-money";

import type { ProductFormComponentApi, ProductFormValues } from "../types";
import { ProductPromotionDates } from "./product-promotion-dates";

interface ProductPromotionFieldProps {
  form: ProductFormComponentApi;
  values: ProductFormValues;
  disabled: boolean;
  currency: string;
  timezone?: string;
  showValidationErrors: boolean;
}

/**
 * The percentage is what gets edited, so it opens the line under the title,
 * next to the price it produces. Dates hide behind a chip and removal behind a
 * faint cross, in order of how rarely each is needed.
 */
export const ProductPromotionField = ({
  form,
  values,
  disabled,
  currency,
  timezone = "Europe/Paris",
  showValidationErrors,
}: ProductPromotionFieldProps) => {
  const t = useTranslations("dashboard.products.form.promotion");
  const formatMoney = useFormatMoney();
  const now = usePricingNow();
  // Focus the percentage only when the offer was just added, not on page load.
  const [justAdded, setJustAdded] = useState(false);
  const promotion = values.promotion;

  if (!promotion)
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setJustAdded(true);
          form.setFieldValue("promotion", { percentage: 0, startsOn: null, endsOn: null });
        }}
        className="flex w-full items-center gap-1.5 border-t py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        <Plus className="size-4" />
        {t("add")}
      </button>
    );

  const basePrice =
    Number(
      (values.pricingKind === "fixed" ? values.price : values.basePriceDuration.price).replace(
        ",",
        ".",
      ),
    ) || 0;
  const preview = applyProductPromotion(basePrice, { ...promotion, startsOn: null, endsOn: null });
  const invalidPercentage =
    showValidationErrors &&
    (!Number.isInteger(promotion.percentage) ||
      promotion.percentage < 1 ||
      promotion.percentage > 99);
  const invalidDates = Boolean(
    promotion.startsOn && promotion.endsOn && promotion.endsOn < promotion.startsOn,
  );

  return (
    <div className="flex flex-col gap-2 border-t py-3" data-slot="product-promotion-field">
      <Label
        htmlFor="product-promotion-percentage"
        className="flex items-center gap-1.5 text-sm font-medium"
      >
        <Tag aria-hidden className="size-4 text-muted-foreground" />
        {t("title")}
      </Label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-3">
          <div className="relative w-20">
            <Input
              id="product-promotion-percentage"
              name="promotion.percentage"
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="20"
              autoFocus={justAdded}
              value={promotion.percentage || ""}
              aria-invalid={invalidPercentage}
              aria-describedby={
                invalidPercentage ? "promotion-percentage-error" : "promotion-description"
              }
              disabled={disabled}
              className="pr-7 tabular-nums"
              onChange={(event) => {
                if (!/^\d*$/.test(event.target.value)) return;
                form.setFieldValue("promotion", {
                  ...promotion,
                  percentage: Number(event.target.value),
                });
              }}
            />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 z-10 flex items-center text-xs text-muted-foreground">
              %
            </span>
          </div>
          {preview.promotion && (
            <p
              className={cn(
                "flex items-baseline gap-1.5 text-sm tabular-nums",
                // An ended offer no longer changes the price: keep the figure, drop its weight.
                getProductPromotionStatus(promotion, timezone, now) === "expired" && "opacity-50",
              )}
              aria-live="polite"
            >
              <s className="text-muted-foreground">{formatMoney(basePrice, { currency })}</s>
              <span className="font-semibold">{formatMoney(preview.subtotal, { currency })}</span>
            </p>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ProductPromotionDates
            promotion={promotion}
            timezone={timezone}
            disabled={disabled}
            invalid={invalidDates}
            onChange={(next) => form.setFieldValue("promotion", next)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground/60 hover:text-destructive"
            disabled={disabled}
            aria-label={t("remove")}
            title={t("remove")}
            onClick={() => {
              setJustAdded(false);
              form.setFieldValue("promotion", null);
            }}
          >
            <X />
          </Button>
        </div>
      </div>
      {invalidPercentage && (
        <p id="promotion-percentage-error" className="text-sm text-destructive">
          {t("invalidPercentage")}
        </p>
      )}
      {invalidDates && <p className="text-sm text-destructive">{t("invalidDates")}</p>}
      <p id="promotion-description" className="text-xs text-muted-foreground">
        {t("description")}
      </p>
    </div>
  );
};
