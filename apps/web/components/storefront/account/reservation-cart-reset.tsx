"use client";

import { useEffect, useRef } from "react";

import { useCart } from "@/contexts/cart-context";
import { useStore } from "@/contexts/store-context";
import { consumeStartedCheckout } from "@/lib/storefront/util.pending-checkout-storage";

interface ReservationCartResetProps {
  reservationId: string;
  /** The page states the outcome as done: the payment recorded, or the request sent. */
  settled: boolean;
}

/**
 * Empties the cart once, when this browser started the checkout of this very
 * reservation (its record of the checkout names it) and the page states the
 * outcome as done. The record is consumed with it: a visit alone, a link to
 * another person's checkout, or an old confirmation opened again leaves the
 * cart as it is. Kept apart from the outcome banner: the banner stays silent
 * on events the status bar already covers, but the cart has to be cleared on
 * all of them. It waits for the cart to have read its storage: a page loaded
 * afresh runs this effect first, and the cart's own read would put the lines
 * back.
 */
export const ReservationCartReset = ({ reservationId, settled }: ReservationCartResetProps) => {
  const { clearCart, isHydrated } = useCart();
  const { storeId } = useStore();
  const hasCleared = useRef(false);

  useEffect(() => {
    if (hasCleared.current || !isHydrated || !settled) return;
    if (!consumeStartedCheckout(storeId, reservationId)) return;
    hasCleared.current = true;
    clearCart();
  }, [settled, isHydrated, storeId, reservationId, clearCart]);

  return null;
};
