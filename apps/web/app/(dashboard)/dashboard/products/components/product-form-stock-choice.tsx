"use client";

import { useState } from "react";

import Link from "next/link";

import { useTranslations } from "next-intl";

import type { StockKindChangeBlocker } from "@louez/db";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Button,
} from "@louez/ui";
import { ArrowRightIcon, InfoCircleIcon } from "@louez/ui/icons";

import { getReservationDetailHref } from "@/lib/product-analytics/reservation-analytics";

import type { ProductFormComponentApi, ProductFormValues } from "../types";
import {
  type StockOption,
  getStockOption,
  getStockOptionFields,
  getStockOptionImpact,
} from "../utils/util.product-kind-choices";
import { ProductFormChoiceCard } from "./product-form-choice-card";
import { ProductFormKindExamplesDialog } from "./product-form-kind-examples-dialog";
import { ProductFormUnitsLearnMore } from "./product-form-units-learn-more";
import { STOCK_OPTION_ICONS } from "./product-kind.constants";

interface ProductFormStockChoiceProps {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  productId?: string;
  stockKindChangeBlockers: StockKindChangeBlocker[];
  /** Marks the applied option; left off on a new product, where nothing has been chosen yet. */
  showCurrent: boolean;
  disabled?: boolean;
  invalid?: boolean;
  onChosen: () => void;
}

/**
 * How the product's stock is followed, as four cards. Each card says, before the
 * click, what the choice changes elsewhere: a consumable moves pricing to a flat
 * rate, leaving unit tracking deletes the registered units, and confirmed or
 * ongoing reservations keep the stock kind as it is.
 */
export const ProductFormStockChoice = ({
  form,
  watchedValues,
  productId,
  stockKindChangeBlockers,
  showCurrent,
  disabled = false,
  invalid = false,
  onChosen,
}: ProductFormStockChoiceProps) => {
  const t = useTranslations("dashboard.products.form");
  const [pendingOption, setPendingOption] = useState<StockOption | null>(null);

  const current = getStockOption(watchedValues);
  const unitCount = watchedValues.units?.length ?? 0;
  const context = {
    current,
    pricingKind: watchedValues.pricingKind,
    stockKindLocked: stockKindChangeBlockers.length > 0,
    unitCount,
  };

  const apply = (option: StockOption) => {
    const impact = getStockOptionImpact(option, context);
    const fields = getStockOptionFields(option);
    if (impact.removesUnits) {
      form.setFieldValue("bookingAttributeAxes", []);
      form.setFieldValue("units", []);
    }
    if (impact.switchesToFixedPrice) form.setFieldValue("pricingKind", "fixed");
    form.setFieldValue("stockKind", fields.stockKind);
    form.setFieldValue("trackUnits", fields.trackUnits);
    onChosen();
  };

  const choose = (option: StockOption) => {
    const impact = getStockOptionImpact(option, context);
    if (impact.blockedByReservations) return;
    if (impact.removesUnits) {
      setPendingOption(option);
      return;
    }
    apply(option);
  };

  const cardProps = (option: StockOption) => {
    const impact = getStockOptionImpact(option, context);
    const notes = impact.blockedByReservations
      ? [t("stockOptionBlocked")]
      : [
          impact.removesUnits ? t("stockOptionRemovesUnits", { count: unitCount }) : null,
          impact.switchesToFixedPrice ? t("stockKindConsumableSwitchesPricing") : null,
        ].filter((note): note is string => note !== null);

    return {
      note: notes.length > 0 ? notes.join(" ") : undefined,
      isCurrent: showCurrent && current === option,
      disabled: disabled || impact.blockedByReservations,
      invalid,
      onSelect: () => choose(option),
    };
  };

  return (
    <div className="space-y-3">
      {stockKindChangeBlockers.length > 0 ? (
        <Alert>
          <InfoCircleIcon />
          <AlertTitle>{t("stockKindChangeBlockedTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("stockKindChangeBlocked")}</p>
            <ul className="flex flex-wrap gap-1.5">
              {stockKindChangeBlockers.map((reservation) => (
                <li key={reservation.id}>
                  <Button
                    variant="outline"
                    size="xs"
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
                    {t("stockKindBlockingReservation", { number: reservation.number })}
                    <ArrowRightIcon data-slot="icon" />
                  </Button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <ProductFormChoiceCard
          icon={<STOCK_OPTION_ICONS.quantity />}
          title={t("unitTracking.modeQuantity")}
          description={t("unitTracking.modeQuantityDescription")}
          action={<ProductFormKindExamplesDialog axis="stock" value="quantity" />}
          {...cardProps("quantity")}
        />
        <ProductFormChoiceCard
          icon={<STOCK_OPTION_ICONS.units />}
          title={t("unitTracking.modeUnits")}
          badge={t("unitTracking.advancedBadge")}
          description={t("unitTracking.modeUnitsDescription")}
          titleInfo={<ProductFormUnitsLearnMore />}
          action={<ProductFormKindExamplesDialog axis="stock" value="units" />}
          {...cardProps("units")}
        />
        <ProductFormChoiceCard
          icon={<STOCK_OPTION_ICONS.consumable />}
          title={t("stockKindConsumable")}
          description={t("stockKindConsumableDescription")}
          action={<ProductFormKindExamplesDialog axis="stock" value="consumable" />}
          {...cardProps("consumable")}
        />
        <ProductFormChoiceCard
          icon={<STOCK_OPTION_ICONS.untracked />}
          title={t("stockKindUntracked")}
          description={t("stockKindUntrackedDescription")}
          action={<ProductFormKindExamplesDialog axis="stock" value="untracked" />}
          {...cardProps("untracked")}
        />
      </div>

      <AlertDialog
        open={pendingOption !== null}
        onOpenChange={(open) => {
          if (!open) setPendingOption(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("unitTracking.disableConfirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("stockOptionRemovesUnits", { count: unitCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t("unitTracking.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={<Button />}
              onClick={() => {
                if (pendingOption) apply(pendingOption);
              }}
            >
              {t("unitTracking.confirm")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
