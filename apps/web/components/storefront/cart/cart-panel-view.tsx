"use client";
import type { MouseEventHandler } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@louez/utils";
import type { CartItem, CartPeriod, CartResolutionStatus } from "@/contexts/cart-context";
import {
  getCartLineAvailableMaximumQuantity,
  groupCartLinesByParent,
} from "@/lib/utils/cart-required-accessories";
import { CartLineItem } from "./cart-line-item";
import { CartPeriodSummary } from "./cart-period-summary";
import { CartUnavailableBanner } from "./cart-unavailable-banner";

export interface CartPanelViewProps {
  className?: string;
  items: CartItem[];
  period: CartPeriod | null;
  resolutionStatus: CartResolutionStatus;
  onRemove: (lineId: string) => void;
  onQuantityChange: (lineId: string, quantity: number) => void;
  onNavigate?: MouseEventHandler<HTMLAnchorElement>;
  getProductHref?: (item: CartItem) => string;
}
export const CartPanelView = ({
  className,
  items,
  period,
  resolutionStatus,
  onRemove,
  onQuantityChange,
  onNavigate,
  getProductHref,
}: CartPanelViewProps) => {
  const t = useTranslations("storefront.cart");
  const unavailableItems = items.filter((item) => Boolean(item.unavailableReason));
  const groups = groupCartLinesByParent(items);

  return (
    <div className={cn("flex flex-col gap-4", className)} data-slot="cart-panel">
      <CartPeriodSummary period={period} />

      {resolutionStatus === "error" ? (
        <p role="status" className="rounded-2xl bg-warning/12 p-4 text-sm text-warning">
          {t("resolveError")}
        </p>
      ) : null}

      <CartUnavailableBanner
        items={unavailableItems}
        onAdjust={onQuantityChange}
        onRemove={onRemove}
      />

      <ul className="divide-y">
        {groups.map((group) => (
          <li key={group.line.lineId}>
            <CartLineItem
              productHref={getProductHref?.(group.line)}
              onNavigate={onNavigate}
              item={group.line}
              maximumQuantity={getCartLineAvailableMaximumQuantity(items, group.line)}
              onQuantityChange={onQuantityChange}
              onRemove={onRemove}
            />
            {group.children.length > 0 ? (
              <ul className="mb-2 ml-4 border-l pl-3">
                {group.children.map((child) => (
                  <li key={child.lineId}>
                    <CartLineItem
                      productHref={getProductHref?.(child)}
                      onNavigate={onNavigate}
                      item={child}
                      maximumQuantity={getCartLineAvailableMaximumQuantity(items, child)}
                      parent={{ name: group.line.productName, quantity: group.line.quantity }}
                      onQuantityChange={onQuantityChange}
                      onRemove={onRemove}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
};
