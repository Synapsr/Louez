"use client";

import { useState } from "react";

import { AlertTriangle, ChevronDown, Lock, Trash2, Unlock } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PricingMode } from "@louez/types";
import {
  Badge,
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  InputPrice,
  InputQuantity,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@louez/ui";
import { cn } from "@louez/utils";

import { ProductImage } from "@/components/product/product-image";

import type { AvailabilityWarning, CalculatedEditableItem } from "../types";

import { TotalPriceEditor } from "./total-price-editor";

interface EditReservationItemCardProps {
  item: CalculatedEditableItem;
  warning: AvailabilityWarning | undefined;
  itemsCount: number;
  currencySymbol: string;
  getDurationUnit: (mode: PricingMode) => string;
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

export function EditReservationItemCard({
  item,
  warning,
  itemsCount,
  currencySymbol,
  getDurationUnit,
  onQuantityChange,
  onPriceChange,
  onTotalPriceChange,
  onDepositChange,
  onToggleManualPrice,
  onRemoveItem,
}: EditReservationItemCardProps) {
  const t = useTranslations("dashboard.reservations");
  const tForm = useTranslations("dashboard.reservations.manualForm");
  const tCommon = useTranslations("common");
  const tProductForm = useTranslations("dashboard.products.form");

  // Conflicted items start expanded so their controls are immediately at hand
  const [open, setOpen] = useState(() => Boolean(warning));

  const unitLabel = getDurationUnit(item.displayPricingMode);
  const isFixedPrice = item.product?.pricingKind === "fixed";
  const displayedUnitPrice = item.isManualPrice ? item.unitPrice : item.effectiveUnitPrice;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      id={item.productId ? `edit-item-product-${item.productId}` : undefined}
      className={cn(
        "bg-background shadow-border rounded-lg p-2 transition-[border-color,box-shadow] duration-300",
        warning && "border-badge-review-foreground",
      )}
    >
      <div className="flex items-center gap-3">
        <ProductImage
          src={item.product?.images?.[0]}
          alt=""
          sizes="48px"
          containerClassName="w-12 shrink-0 rounded-md"
        />
        <div className="min-w-0 flex-1">
          <p title={item.productSnapshot.name} className="truncate font-medium">
            {item.productSnapshot.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {!item.product && (
              <Badge variant="expired" className="shrink-0 text-[10px]">
                {tForm("customItem.badge")}
              </Badge>
            )}
            {warning &&
              ((warning.turnoverBufferMinutes ?? 0) > 0 ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="flex cursor-help items-center gap-1 text-xs text-amber-600 dark:text-amber-400" />
                    }
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {t("edit.stockConflictInline", {
                      requested: warning.requestedQuantity,
                      available: warning.availableQuantity,
                    })}
                  </TooltipTrigger>
                  <TooltipContent>
                    {tForm("warnings.turnoverBufferConflictDetails", {
                      duration: warning.turnoverBufferMinutes ?? 0,
                    })}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  {t("edit.stockConflictInline", {
                    requested: warning.requestedQuantity,
                    available: warning.availableQuantity,
                  })}
                </span>
              ))}
          </div>
        </div>
        <div className="flex items-center gap-0">
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground h-8 w-8 shrink-0"
                aria-label={`${tCommon("details")}, ${item.productSnapshot.name}`}
              />
            }
          >
            <ChevronDown
              className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
            />
          </CollapsibleTrigger>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-8 w-8 shrink-0"
                  onClick={() => onRemoveItem(item.id)}
                  disabled={itemsCount <= 1}
                />
              }
            >
              <Trash2 className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{tCommon("delete")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {!open && (
        <div className="mt-2 flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground flex items-center gap-2 tabular-nums">
            {item.isManualPrice && item.product ? (
              <Badge variant="pending" className="text-[10px]">
                Manuel
              </Badge>
            ) : (
              item.tierLabel && (
                <Badge variant="success" className="text-[10px] tabular-nums">
                  {item.tierLabel}
                </Badge>
              )
            )}
            <span>
              {isFixedPrice ? (
                <>
                  {item.quantity} × {displayedUnitPrice.toFixed(2)}
                  {currencySymbol} · {tProductForm("fixedPriceLabel")}
                </>
              ) : (
                <>
                  {item.quantity} × {item.duration} {unitLabel} · {displayedUnitPrice.toFixed(2)}
                  {currencySymbol}/{unitLabel}
                </>
              )}
            </span>
          </span>
          <span className="font-semibold tabular-nums">
            {item.totalPrice.toFixed(2)}
            {currencySymbol}
          </span>
        </div>
      )}

      <CollapsiblePanel>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t pt-3">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="space-y-1">
              <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {t("edit.qty")}
              </p>
              <InputQuantity
                value={item.quantity}
                onChange={(quantity) => onQuantityChange(item.id, quantity)}
                ariaLabel={`${t("edit.qty")}, ${item.productSnapshot.name}`}
              />
            </div>

            <div className="space-y-1">
              <p className="text-muted-foreground flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase">
                {t("edit.unitPrice")}
                {item.tierLabel && !item.isManualPrice && (
                  <Badge
                    variant="success"
                    className="text-[8px]! h-4 py-0 px-1 font-semibold normal-case tracking-normal tabular-nums"
                  >
                    {item.tierLabel}
                  </Badge>
                )}
              </p>
              <div className="flex items-center gap-1">
                <InputPrice
                  value={displayedUnitPrice}
                  onValueCommitted={(price) =>
                    onPriceChange(item.id, price, item.displayPricingMode)
                  }
                  suffix={isFixedPrice ? currencySymbol : `${currencySymbol}/${unitLabel}`}
                  ariaLabel={`${t("edit.unitPrice")}, ${item.productSnapshot.name}`}
                  className={cn(
                    item.isManualPrice && "border-amber-300 bg-amber-50 dark:bg-amber-950/20",
                  )}
                />
                {item.product && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() =>
                            onToggleManualPrice(
                              item.id,
                              item.effectiveUnitPrice,
                              item.displayPricingMode,
                            )
                          }
                        />
                      }
                    >
                      {item.isManualPrice ? (
                        <Lock className="h-3.5 w-3.5 text-amber-600" />
                      ) : (
                        <Unlock className="text-muted-foreground h-3.5 w-3.5" />
                      )}
                    </TooltipTrigger>
                    <TooltipContent>
                      {item.isManualPrice ? t("edit.unlockPrice") : t("edit.lockPrice")}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-col items-end gap-y-3">
            <div className="flex flex-col items-end space-y-1">
              <p className="text-muted-foreground text-right text-[10px] font-medium tracking-wide uppercase">
                {t("edit.deposit")}
              </p>
              <InputPrice
                value={item.depositPerUnit}
                onValueCommitted={(depositPerUnit) => onDepositChange(item.id, depositPerUnit)}
                suffix={currencySymbol}
                ariaLabel={`${t("edit.deposit")}, ${item.productSnapshot.name}`}
              />
            </div>

            <div className="flex flex-col items-end space-y-1">
              <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {t("edit.total")}
              </p>
              <TotalPriceEditor
                value={item.totalPrice}
                savings={item.savings}
                isManual={item.isManualPrice}
                currencySymbol={currencySymbol}
                onChange={(totalPrice) =>
                  onTotalPriceChange(item.id, totalPrice, item.displayPricingMode)
                }
                ariaLabel={`${tForm("customItem.totalPrice")}, ${item.productSnapshot.name}`}
              />
            </div>
          </div>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
