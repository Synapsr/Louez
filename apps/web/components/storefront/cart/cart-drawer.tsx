"use client";

import { useSearchParams } from "next/navigation";

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
import { type CartResolutionStatus, useCartDrawer, useCartState } from "@/contexts/cart-context";
import { useStorePath } from "@/hooks/use-store-path";
import { buildCheckoutHref } from "@/lib/utils/util.checkout-return";

import { useMediaQuery } from "@/hooks/use-media-query";

import { CartEmptyState } from "./cart-empty-state";
import { CartPanel } from "./cart-panel";
import { CartTotals } from "./cart-totals";

/** Side panel from `lg`; a bottom sheet below (design language §6). */
const SIDE_PANEL_QUERY = "(min-width: 1024px)";

const getBlockedReasonKey = (
  status: CartResolutionStatus,
  hasUnavailableLines: boolean,
): "checkoutBlocked" | "checking" | "resolveError" | null => {
  if (hasUnavailableLines) {
    return "checkoutBlocked";
  }
  if (status === "loading") {
    return "checking";
  }
  if (status === "error") {
    return "resolveError";
  }
  return null;
};

/**
 * The global cart. Mounted once in the storefront shell; product pages open
 * it through `useCartDrawer()` after an add.
 */
export const CartDrawer = () => {
  const t = useTranslations("storefront.cart");
  const { isOpen, setOpen, close } = useCartDrawer();
  const { items, summary, resolutionStatus, hasUnavailableLines } = useCartState();
  const storePath = useStorePath();
  const searchParams = useSearchParams();
  const checkoutHref = buildCheckoutHref(storePath, searchParams.toString());
  const isSidePanel = useMediaQuery(SIDE_PANEL_QUERY);
  const isEmpty = items.length === 0;
  const blockedReasonKey = getBlockedReasonKey(resolutionStatus, hasUnavailableLines);

  return (
    <Drawer open={isOpen} onOpenChange={setOpen} position={isSidePanel ? "right" : "bottom"}>
      <DrawerPopup showCloseButton={isSidePanel} variant="inset" className="lg:max-w-md">
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
            <div className="my-auto w-full">
              <CartEmptyState onNavigate={close} closeOnly={storePath === "/catalog"} />
            </div>
          </div>
        ) : (
          <DrawerPanel>
            <CartPanel />
          </DrawerPanel>
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
                render={<StorefrontLink href={checkoutHref} onClick={close} />}
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
