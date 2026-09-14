"use client";

import { useMemo } from "react";

import Link from "next/link";

import { useTranslations } from "next-intl";

import type { StockKindChangeBlocker } from "@louez/db";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@louez/ui";
import { DatabaseIcon } from "@louez/ui/icons";

import { UnitTrackingEditor } from "@/components/dashboard/unit-tracking-editor";

import { useChoiceStep } from "../hooks/use-choice-step";
import { useProductKindLabels } from "../hooks/use-product-kind-labels";
import type { ProductFormComponentApi, ProductFormValues } from "../types";
import { getStockOption } from "../utils/util.product-kind-choices";
import { ProductFormChoiceHeaderAction } from "./product-form-choice-header-action";
import { ProductFormStockChoice } from "./product-form-stock-choice";

type QuantityFieldMeta = {
  errorMap?: Record<string, unknown>;
};

interface ProductFormSectionStockProps {
  form: ProductFormComponentApi;
  productId?: string;
  stockKindChangeBlockers?: StockKindChangeBlocker[];
  watchedValues: ProductFormValues;
  currency: string;
  disabled?: boolean;
  showValidationErrors?: boolean;
}

export function ProductFormSectionStock({
  form,
  productId,
  stockKindChangeBlockers = [],
  watchedValues,
  currency,
  disabled,
  showValidationErrors = false,
}: ProductFormSectionStockProps) {
  const t = useTranslations("dashboard.products.form");
  const tInventory = useTranslations("dashboard.inventory.productScoped");

  // A new product opens on the stock choice, unless the form already carries
  // one; an existing product opens on its stock.
  const step = useChoiceStep(
    Boolean(productId) ||
      (watchedValues.stockKind ?? "returnable") !== "returnable" ||
      Boolean(watchedValues.trackUnits) ||
      (watchedValues.units?.length ?? 0) > 0 ||
      (parseInt(watchedValues.quantity || "1", 10) || 1) > 1,
  );

  const labels = useProductKindLabels();
  const option = getStockOption(watchedValues);

  // "Vélo gravel VFD" → "VELO-" : accent-stripped first word, used as the
  // suggested reference prefix for generated units.
  const defaultPrefix = useMemo(() => {
    const firstWord = (watchedValues.name || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/\s+/)[0]
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase()
      .slice(0, 6);
    return firstWord ? `${firstWord}-` : "";
  }, [watchedValues.name]);

  const description = step.isChoosing
    ? t("stockKindQuestion")
    : option === "untracked"
      ? t("untrackedStockHelp")
      : option === "consumable"
        ? t("consumableQuantityHelp")
        : t("quantityHelp");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon className="text-primary h-5 w-5 shrink-0 stroke-2" />
          {t("stock")}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <ProductFormChoiceHeaderAction
            step={step}
            choice={labels.stock[option]}
            disabled={disabled}
          />
          {productId && option !== "untracked" && !step.isChoosing ? (
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/dashboard/products/${productId}`} />}
            >
              <DatabaseIcon className="h-4 w-4" />
              {tInventory("openInventory")}
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>

      {step.isChoosing ? (
        <CardContent>
          <ProductFormStockChoice
            form={form}
            watchedValues={watchedValues}
            productId={productId}
            stockKindChangeBlockers={stockKindChangeBlockers}
            showCurrent={step.isAnswered}
            disabled={disabled}
            invalid={showValidationErrors}
            onChosen={step.answer}
          />
        </CardContent>
      ) : option === "untracked" ? null : (
        <CardContent className="space-y-6">
          <UnitTrackingEditor
            currency={currency}
            trackUnits={option === "units"}
            bookingAttributeAxes={watchedValues.bookingAttributeAxes || []}
            onBookingAttributeAxesChange={(axes) =>
              form.setFieldValue("bookingAttributeAxes", axes)
            }
            units={watchedValues.units || []}
            onChange={(units) => form.setFieldValue("units", units)}
            quantity={watchedValues.quantity || "1"}
            onQuantityChange={(value) => {
              form.setFieldMeta("quantity", (prev: QuantityFieldMeta | undefined) => ({
                ...prev,
                errorMap: { ...prev?.errorMap, onSubmit: undefined },
              }));
              form.setFieldValue("quantity", value);
            }}
            defaultPrefix={defaultPrefix}
            disabled={disabled}
            showValidationErrors={showValidationErrors}
            productId={productId}
          />
        </CardContent>
      )}
    </Card>
  );
}
