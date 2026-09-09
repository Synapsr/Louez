"use client";

import { useCallback } from "react";

import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import { useCartActions, useCartState } from "@/contexts/cart-context";
import {
  getCartLineAvailableMaximumQuantity,
  groupCartLinesByParent,
} from "@/lib/utils/cart-required-accessories";

import { CartLineItem } from "./cart-line-item";
import { CartPeriodSummary } from "./cart-period-summary";
import { CartUnavailableBanner } from "./cart-unavailable-banner";

interface CartPanelProps {
  className?: string;
}

/**
 * The body of the cart: period, refused lines, then every line with its
 * required accessories nested. Removing a line offers an undo toast.
 */
export const CartPanel = ({ className }: CartPanelProps) => {
  const t = useTranslations("storefront.cart");
  const { items, period, resolutionStatus } = useCartState();
  const { removeItemByLineId, restoreLines, updateItemQuantityByLineId } = useCartActions();

  const handleRemove = useCallback(
    (lineId: string) => {
      const removed = removeItemByLineId(lineId);
      const parent = removed.find((line) => line.lineId === lineId);
      if (!parent) {
        return;
      }
      toastManager.add({
        title: t("removed", { name: parent.productName }),
        actionProps: { children: t("undo"), onClick: () => restoreLines(removed) },
      });
    },
    [removeItemByLineId, restoreLines, t],
  );

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
        onAdjust={updateItemQuantityByLineId}
        onRemove={handleRemove}
      />

      <ul className="divide-y">
        {groups.map((group) => (
          <li key={group.line.lineId}>
            <CartLineItem
              item={group.line}
              maximumQuantity={getCartLineAvailableMaximumQuantity(items, group.line)}
              onQuantityChange={updateItemQuantityByLineId}
              onRemove={handleRemove}
            />
            {group.children.length > 0 ? (
              <ul className="mb-2 ml-4 border-l pl-3">
                {group.children.map((child) => (
                  <li key={child.lineId}>
                    <CartLineItem
                      item={child}
                      maximumQuantity={getCartLineAvailableMaximumQuantity(items, child)}
                      parent={{ name: group.line.productName, quantity: group.line.quantity }}
                      onQuantityChange={updateItemQuantityByLineId}
                      onRemove={handleRemove}
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
