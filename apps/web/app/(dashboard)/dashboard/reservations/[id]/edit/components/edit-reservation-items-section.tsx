"use client";

import { useMemo } from "react";

import { PenLine } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PricingMode } from "@louez/types";
import { Button, Card, CardContent } from "@louez/ui";
import type { StockQuantityLimit } from "@louez/utils";

import { ProductAddCombobox } from "@/components/dashboard/product-add-combobox";

import type { AvailabilityWarning, Product, ReservationCalculations } from "../types";

import { EditReservationItemCard } from "./edit-reservation-item-card";

interface EditReservationItemsSectionProps {
  calculations: ReservationCalculations;
  availabilityWarnings: AvailabilityWarning[];
  availableToAdd: Product[];
  availableQuantityByProduct: Map<string, StockQuantityLimit>;
  itemsCount: number;
  currencySymbol: string;
  getDurationUnit: (mode: PricingMode) => string;
  onOpenCustomItemDialog: () => void;
  onAddProduct: (productId: string) => void;
  onQuantityChange: (itemId: string, quantity: number) => void;
  onPriceChange: (itemId: string, price: number, pricingMode?: PricingMode) => void;
  onTotalPriceChange: (itemId: string, totalPrice: number, pricingMode?: PricingMode) => void;
  onDepositChange: (itemId: string, depositPerUnit: number) => void;
  onToggleManualPrice: (
    itemId: string,
    effectiveUnitPrice?: number,
    pricingMode?: PricingMode,
  ) => void;
  onRemoveItem: (itemId: string) => void;
}

export function EditReservationItemsSection({
  calculations,
  availabilityWarnings,
  availableToAdd,
  availableQuantityByProduct,
  itemsCount,
  currencySymbol,
  getDurationUnit,
  onOpenCustomItemDialog,
  onAddProduct,
  onQuantityChange,
  onPriceChange,
  onTotalPriceChange,
  onDepositChange,
  onToggleManualPrice,
  onRemoveItem,
}: EditReservationItemsSectionProps) {
  const t = useTranslations("dashboard.reservations");
  const tForm = useTranslations("dashboard.reservations.manualForm");
  const tCommon = useTranslations("common");

  // What the add sheet echoes back per row, so a tap has a visible answer even
  // though the item cards it updates sit behind the sheet on mobile.
  const selectedQuantityByProduct = useMemo(() => {
    const map = new Map<string, number>();

    for (const item of calculations.items) {
      if (!item.productId) continue;

      map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
    }

    return map;
  }, [calculations.items]);

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-muted-foreground text-sm font-medium">{t("edit.items")}</h2>
          {/* Same row as the new-reservation step: the custom item takes only
              what its label needs, the product picker gets the rest. */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="min-w-0 shrink max-sm:max-w-[50%]"
              onClick={onOpenCustomItemDialog}
            >
              <PenLine data-slot="icon" className="size-4" />
              <span className="truncate">{tForm("customItem.button")}</span>
            </Button>
            {availableToAdd.length > 0 && (
              <ProductAddCombobox
                products={availableToAdd}
                availableQuantityByProduct={availableQuantityByProduct}
                onAddProduct={onAddProduct}
                placeholder={t("edit.addItem")}
                searchPlaceholder={t("edit.searchProductsPlaceholder", {
                  count: availableToAdd.length,
                })}
                emptyLabel={t("edit.noProductsFound")}
                unavailableLabel={t("edit.unavailableForPeriod")}
                availableLabel={tForm("available")}
                doneLabel={tCommon("done")}
                selectedQuantityByProduct={selectedQuantityByProduct}
                className="min-w-0 flex-1"
              />
            )}
          </div>
        </div>

        <div className="space-y-3">
          {calculations.items.map((item) => (
            <EditReservationItemCard
              key={item.id}
              item={item}
              warning={availabilityWarnings.find(
                (candidate) => candidate.productId === item.productId,
              )}
              itemsCount={itemsCount}
              currencySymbol={currencySymbol}
              getDurationUnit={getDurationUnit}
              onQuantityChange={onQuantityChange}
              onPriceChange={onPriceChange}
              onTotalPriceChange={onTotalPriceChange}
              onDepositChange={onDepositChange}
              onToggleManualPrice={onToggleManualPrice}
              onRemoveItem={onRemoveItem}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
