"use client";
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { toastManager } from "@louez/ui";
import { useCartActions, useCartState, useCartDrawer } from "@/contexts/cart-context";
import { CartPanelView } from "./cart-panel-view";

export const CartPanel = ({ className }: { className?: string }) => {
  const t = useTranslations("storefront.cart");
  const { items, period, resolutionStatus } = useCartState();
  const { close } = useCartDrawer();
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

  return (
    <CartPanelView
      className={className}
      items={items}
      period={period}
      resolutionStatus={resolutionStatus}
      onRemove={handleRemove}
      onQuantityChange={updateItemQuantityByLineId}
      onNavigate={close}
    />
  );
};
