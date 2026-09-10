"use client";

import { useEffect, useRef } from "react";

import { useCart } from "@/contexts/cart-context";
import type { ReservationOutcomeEvent } from "@/lib/customer-auth/util.account-redirect";
import { clearPendingCheckout } from "@/lib/storefront/util.pending-checkout-storage";

/**
 * Empties the cart once, when the page is reached straight from a checkout,
 * and forgets the pending reservation the checkout left behind for a resume.
 * Kept apart from the outcome banner: the banner stays silent on events the
 * status bar already covers, but the cart has to be cleared on all of them.
 */
export const ReservationCartReset = ({ event }: { event: ReservationOutcomeEvent | null }) => {
  const { clearCart } = useCart();
  const hasCleared = useRef(false);

  useEffect(() => {
    if (hasCleared.current) return;
    if (event !== "paid" && event !== "requested") return;
    hasCleared.current = true;
    clearCart();
    clearPendingCheckout();
  }, [event, clearCart]);

  return null;
};
