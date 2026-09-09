"use client";

import { AlertCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import type { CartItem } from "@/contexts/cart-context";

interface CartUnavailableBannerProps {
  /** Lines the last resolution refused, in cart order. */
  items: CartItem[];
  onAdjust: (lineId: string, quantity: number) => void;
  onRemove: (lineId: string) => void;
  className?: string;
}

/**
 * Lists the lines that cannot be booked as they are, each with the one or
 * two ways out: take what is left, or drop the line. Required accessories
 * follow their parent, so they only get the adjust action.
 */
export const CartUnavailableBanner = ({
  items,
  onAdjust,
  onRemove,
  className,
}: CartUnavailableBannerProps) => {
  const t = useTranslations("storefront.cart");

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-2xl bg-destructive/12 p-4 text-destructive",
        className,
      )}
      data-slot="cart-unavailable-banner"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <AlertCircleIcon aria-hidden className="size-4 shrink-0" />
        {t("unavailableTitle", { count: items.length })}
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const remaining =
            typeof item.maxQuantity === "number" && item.maxQuantity >= 1 ? item.maxQuantity : null;

          return (
            <li
              key={item.lineId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {item.productName}
                <span className="ml-1 text-xs opacity-80">
                  {item.unavailableReason ? t(`unavailable.${item.unavailableReason}`) : null}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                {remaining !== null && remaining < item.quantity ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 bg-background text-foreground"
                    onClick={() => onAdjust(item.lineId, remaining)}
                  >
                    {t("adjustTo", { count: remaining })}
                  </Button>
                ) : null}
                {!item.parentLineId ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-9 text-destructive hover:text-destructive"
                    onClick={() => onRemove(item.lineId)}
                  >
                    {t("remove")}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
