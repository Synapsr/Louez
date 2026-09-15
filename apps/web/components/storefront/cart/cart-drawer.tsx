"use client";
import { useSearchParams } from "next/navigation";
import { type CartResolutionStatus, useCartDrawer, useCartState } from "@/contexts/cart-context";
import { useStorePath } from "@/hooks/use-store-path";
import { buildCheckoutHref } from "@/lib/utils/util.checkout-return";
import { CartEmptyState } from "./cart-empty-state";
import { CartPanel } from "./cart-panel";
import { CartDrawerView } from "./cart-drawer-view";

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

export const CartDrawer = () => {
  const { isOpen, setOpen, close } = useCartDrawer();
  const { items, summary, resolutionStatus, hasUnavailableLines } = useCartState();
  const storePath = useStorePath();
  const searchParams = useSearchParams();
  const checkoutHref = buildCheckoutHref(storePath, searchParams.toString());
  const isEmpty = items.length === 0;
  const blockedReasonKey = getBlockedReasonKey(resolutionStatus, hasUnavailableLines);

  return (
    <CartDrawerView
      isOpen={isOpen}
      setOpen={setOpen}
      close={close}
      summary={summary}
      isEmpty={isEmpty}
      blockedReasonKey={blockedReasonKey}
      checkoutHref={checkoutHref}
      emptyState={<CartEmptyState onNavigate={close} closeOnly={storePath === "/catalog"} />}
    >
      <CartPanel />
    </CartDrawerView>
  );
};
