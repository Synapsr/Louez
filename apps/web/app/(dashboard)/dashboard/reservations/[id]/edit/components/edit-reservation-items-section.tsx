"use client";

import { useState } from "react";

import { ChevronsUpDown, ImageIcon, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PricingMode } from "@louez/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@louez/ui";
import { cn } from "@louez/utils";

import type { AvailabilityWarning, Product, ReservationCalculations } from "../types";

import { EditReservationItemCard } from "./edit-reservation-item-card";

interface EditReservationItemsSectionProps {
  calculations: ReservationCalculations;
  availabilityWarnings: AvailabilityWarning[];
  availableToAdd: Product[];
  availableQuantityByProduct: Map<string, number>;
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

function ProductAddCombobox({
  products,
  availableQuantityByProduct,
  onAddProduct,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  unavailableLabel,
  availableLabel,
}: {
  products: Product[];
  availableQuantityByProduct: Map<string, number>;
  onAddProduct: (productId: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyLabel: string;
  unavailableLabel: string;
  availableLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProducts = products.filter((product) =>
    product.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-9 w-fit justify-between  group"
          />
        }
      >
        {/* <Plus data-slot="icon" className="size-4 shrink-0" /> */}
        <span className="flex-1 min-w-0 justify-start gap-2 w-full">
          <span className="truncate">{placeholder}</span>
        </span>
        <ChevronsUpDown
          data-slot="icon"
          className="transition-opacity size-4 opacity-70 group-hover:opacity-100"
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) sm:w-[360px] p-0 pt-1 *:p-0"
        align="end"
      >
        <Command open items={filteredProducts} filter={null}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <CommandEmpty>{emptyLabel}</CommandEmpty>
          <CommandList className="max-h-[320px] not-empty:pt-0">
            <CommandGroup>
              {filteredProducts.map((product) => {
                const remaining = availableQuantityByProduct.get(product.id);
                const isUnavailable = remaining !== undefined && remaining <= 0;

                return (
                  <CommandItem
                    key={product.id}
                    value={product.id}
                    onClick={() => {
                      onAddProduct(product.id);
                      setOpen(false);
                      setSearchQuery("");
                    }}
                    className="flex items-center gap-2"
                  >
                    <div className="bg-muted relative h-auto aspect-4/3 w-8 shrink-0 overflow-hidden rounded-md">
                      {product.images && product.images.length > 0 ? (
                        // Product thumbnails already use direct URLs in this feature.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.images[0]}
                          alt=""
                          className={cn(
                            "h-full  w-full object-cover",
                            isUnavailable && "opacity-40",
                          )}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ImageIcon className="text-muted-foreground h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>

                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        isUnavailable && "text-muted-foreground",
                      )}
                    >
                      {product.name}
                    </span>
                    {isUnavailable ? (
                      <Badge variant="warning" size="default">
                        {unavailableLabel}
                      </Badge>
                    ) : (
                      remaining !== undefined && (
                        <Badge variant="tertiary" className={cn("tabular-nums")}>
                          {remaining} {availableLabel}
                        </Badge>
                      )
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
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

  return (
    <Card>
      <CardContent className="p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-muted-foreground text-sm font-medium">{t("edit.items")}</h2>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <Button variant="outline" onClick={onOpenCustomItemDialog}>
              <PenLine data-slot="icon" className="size-4" />
              {tForm("customItem.button")}
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
