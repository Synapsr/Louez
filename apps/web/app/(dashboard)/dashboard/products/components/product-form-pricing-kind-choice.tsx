"use client";

import { useTranslations } from "next-intl";

import type { PricingKind } from "@louez/types";

import type { ProductFormComponentApi, ProductFormValues } from "../types";
import { getPricingKindImpact } from "../utils/util.product-kind-choices";
import { ProductFormChoiceCard } from "./product-form-choice-card";
import { ProductFormKindExamplesDialog } from "./product-form-kind-examples-dialog";
import { PRICING_KIND_ICONS } from "./product-kind.constants";

interface ProductFormPricingKindChoiceProps {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  /** Marks the applied option; left off on a new product, where nothing has been chosen yet. */
  showCurrent: boolean;
  stockKindLocked: boolean;
  disabled?: boolean;
  invalid?: boolean;
  onChosen: () => void;
}

export const ProductFormPricingKindChoice = ({
  form,
  watchedValues,
  showCurrent,
  stockKindLocked,
  disabled = false,
  invalid = false,
  onChosen,
}: ProductFormPricingKindChoiceProps) => {
  const t = useTranslations("dashboard.products.form");
  const current = watchedValues.pricingKind ?? "duration";
  const context = { stockKind: watchedValues.stockKind, stockKindLocked };
  const durationImpact = getPricingKindImpact("duration", context);

  const choose = (kind: PricingKind) => {
    const impact = getPricingKindImpact(kind, context);
    if (impact.blockedByReservations) return;
    form.setFieldValue("pricingKind", kind);
    if (impact.switchesStockToQuantity) form.setFieldValue("stockKind", "returnable");
    onChosen();
  };

  const durationNote = durationImpact.blockedByReservations
    ? t("pricingKindDurationBlocked")
    : durationImpact.switchesStockToQuantity
      ? t("pricingKindDurationSwitchesStock")
      : undefined;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ProductFormChoiceCard
        icon={<PRICING_KIND_ICONS.duration />}
        title={t("pricingKindDuration")}
        description={t("pricingKindDurationDescription")}
        action={<ProductFormKindExamplesDialog axis="pricing" value="duration" />}
        note={durationNote}
        isCurrent={showCurrent && current === "duration"}
        disabled={disabled || durationImpact.blockedByReservations}
        invalid={invalid}
        onSelect={() => choose("duration")}
      />
      <ProductFormChoiceCard
        icon={<PRICING_KIND_ICONS.fixed />}
        title={t("pricingKindFixed")}
        description={t("pricingKindFixedDescription")}
        action={<ProductFormKindExamplesDialog axis="pricing" value="fixed" />}
        isCurrent={showCurrent && current === "fixed"}
        disabled={disabled}
        invalid={invalid}
        onSelect={() => choose("fixed")}
      />
    </div>
  );
};
