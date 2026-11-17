"use client";

import { useEffect, useRef } from "react";

import { useCart } from "@/contexts/cart-context";
import { useStore } from "@/contexts/store-context";
import { consumeStartedCheckout } from "@/lib/storefront/util.pending-checkout-storage";

import type { CartResetOutcome } from "./util.cart-reset-outcome";

interface ReservationCartResetProps {
  reservationId: string;
  outcome: CartResetOutcome;
}

/**
 * Empties the cart once, when this browser started the checkout of this very
 * reservation (its record names it, and names the same kind of checkout as
 * the outcome) and the page states the outcome as done. The record is consumed with it: a visit alone, a link to
 * another person's checkout, or an old confirmation opened again leaves the
 * cart as it is. Kept apart from the outcome banner: the banner stays silent
 * on events the status bar already covers, but the cart has to be cleared on
 * all of them. It waits for the cart to have read its storage: a page loaded
 * afresh runs this effect first, and the cart's own read would put the lines
 * back.
 */
export const ReservationCartReset = ({ reservationId, outcome }: ReservationCartResetProps) => {
  const { clearCart, isHydrated } = useCart();
  const { storeId } = useStore();
  const hasCleared = useRef(false);

  useEffect(() => {
    if (hasCleared.current || !isHydrated || !outcome) return;
    const kind = outcome === "paid" ? "payment" : "request";
    if (!consumeStartedCheckout(storeId, reservationId, kind)) return;
    hasCleared.current = true;
    clearCart();
  }, [outcome, isHydrated, storeId, reservationId, clearCart]);

  return null;
};
