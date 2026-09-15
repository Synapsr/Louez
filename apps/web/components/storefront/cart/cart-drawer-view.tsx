"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Drawer,
  DrawerFooter,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@louez/ui";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import type { CartSummary } from "@/contexts/cart-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { CartTotals } from "./cart-totals";

export interface CartDrawerViewProps {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
  summary: CartSummary;
  isEmpty: boolean;
  blockedReasonKey: "checkoutBlocked" | "checking" | "resolveError" | null;
  checkoutHref?: string;
  checkoutDisabled?: boolean;
  autoFocus?: boolean;
  modal?: boolean;
  emptyState: ReactNode;
  children: ReactNode;
}

export const CartDrawerView = ({
  isOpen,
  setOpen,
  close,
  summary,
  isEmpty,
  blockedReasonKey,
  checkoutHref,
  checkoutDisabled = false,
  autoFocus = true,
  modal = true,
  emptyState,
  children,
}: CartDrawerViewProps) => {
  const t = useTranslations("storefront.cart");
  const isSidePanel = useMediaQuery("(min-width: 1024px)");
  return (
    <Drawer
      modal={modal}
      open={isOpen}
      onOpenChange={setOpen}
      position={isSidePanel ? "right" : "bottom"}
    >
      <DrawerPopup
        initialFocus={autoFocus}
        finalFocus={autoFocus}
        showCloseButton={isSidePanel}
        variant="inset"
        className="lg:max-w-md"
      >
        <DrawerHeader>
          <DrawerTitle className="flex items-baseline gap-2 text-xl font-semibold tracking-tight">
            {t("title")}
            {summary.count > 0 ? (
              <span className="text-sm font-normal text-muted-foreground">
                {t("itemsPlural", { count: summary.count })}
              </span>
            ) : null}
          </DrawerTitle>
        </DrawerHeader>

        {isEmpty ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain touch-pan-y p-6">
            <div className="my-auto w-full">{emptyState}</div>
          </div>
        ) : (
          <DrawerPanel>{children}</DrawerPanel>
        )}

        {isEmpty ? null : (
          <DrawerFooter variant="bare" className="flex-col gap-3 sm:flex-col">
            <CartTotals summary={summary} />
            {blockedReasonKey ? (
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  size="xl"
                  className="w-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
                  disabled
                >
                  {t("checkout")}
                </Button>
                <p className="text-center text-xs text-muted-foreground">{t(blockedReasonKey)}</p>
              </div>
            ) : (
              <Button
                size="xl"
                className="w-full"
                type="button"
                disabled={checkoutDisabled}
                data-slot="cart-checkout"
                render={
                  checkoutHref && !checkoutDisabled ? (
                    <StorefrontLink href={checkoutHref} onClick={close} />
                  ) : undefined
                }
              >
                {t("checkout")}
              </Button>
            )}
            <Button variant="tertiary" size="xl" className="w-full" onClick={close}>
              {t("continueShopping")}
            </Button>
          </DrawerFooter>
        )}
      </DrawerPopup>
    </Drawer>
  );
};
