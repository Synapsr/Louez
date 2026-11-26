"use client";

import { useCallback, useMemo, useState } from "react";

import { useMutation } from "@tanstack/react-query";

import { calculateCartItemPrice } from "@/lib/utils/cart-pricing";
import type { CartItem } from "@/contexts/cart-context";
import { checkoutMutations } from "@/lib/queries/checkout.queries";

import type { PartnerPerkView } from "@louez/api/contracts/partners";

import type { CheckoutPromo } from "../checkout.types";

interface UseCheckoutPromoParams {
  items: CartItem[];
  /** Rental subtotal after tier discounts, before promo. */
  subtotal: number;
}

/** Server error key (`errors.*`) plus its interpolation values. */
export interface PromoValidationError {
  key: string;
  params?: Record<string, string>;
}

/**
 * Promo state for the checkout: a code the customer typed, or the perk of the
 * partner the booking credits. The server reprices the cart and caps the
 * discount; the client only re-derives the amount from the promo type when
 * the subtotal moves, and drops a promo whose minimum is no longer met. A
 * perk is never validated here: its promo code stays on the server, which
 * applies it at booking.
 */
export const useCheckoutPromo = ({ items, subtotal }: UseCheckoutPromoParams) => {
  const discountableSubtotal = items.reduce((sum, item) => {
    const price = calculateCartItemPrice(item, null, null);
    return sum + (price.promotion ? 0 : price.subtotal);
  }, 0);
  const [appliedPromo, setAppliedPromo] = useState<CheckoutPromo | null>(null);
  const [validationError, setValidationError] = useState<PromoValidationError | null>(null);

  const validateMutation = useMutation({
    ...checkoutMutations.validatePromo(),
    onSuccess: (result) => {
      if (!result.ok) {
        setValidationError({ key: result.error, params: result.errorParams });
        return;
      }
      setValidationError(null);
      const { code, type, value, minimumAmount } = result.promo;
      setAppliedPromo({ source: "code", code, type, value, minimumAmount });
    },
    onError: () => {
      setValidationError({ key: "errors.promoCodeInvalid" });
    },
  });

  const validate = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) return;
      setValidationError(null);
      validateMutation.mutate({
        code: trimmed,
        lines: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          startDate: item.startDate,
          endDate: item.endDate,
        })),
      });
    },
    [items, validateMutation],
  );

  /** The partner's perk, unless the customer already applied a promo. */
  const applyPartnerPerk = useCallback((perk: PartnerPerkView) => {
    setAppliedPromo((current) => current ?? { source: "partner", ...perk });
  }, []);

  const remove = useCallback(() => {
    setAppliedPromo(null);
    setValidationError(null);
  }, []);

  /** Drops the partner's perk, leaving a code the customer typed. */
  const removePartnerPerk = useCallback(() => {
    setAppliedPromo((current) => (current?.source === "partner" ? null : current));
  }, []);

  const clearError = useCallback(() => setValidationError(null), []);

  // Derived, not synced: a promo whose minimum is no longer met simply stops
  // applying; the summary shows it as gone.
  const promo = useMemo(() => {
    if (!appliedPromo || discountableSubtotal <= 0) return null;
    if (appliedPromo.minimumAmount > 0 && subtotal < appliedPromo.minimumAmount) {
      return null;
    }
    return appliedPromo;
  }, [appliedPromo, subtotal, discountableSubtotal]);

  const discountAmount = useMemo(() => {
    if (!promo) return 0;
    const raw =
      promo.type === "percentage"
        ? Math.min((discountableSubtotal * promo.value) / 100, discountableSubtotal)
        : Math.min(promo.value, discountableSubtotal);
    return Math.round(raw * 100) / 100;
  }, [promo, discountableSubtotal]);

  return {
    promo,
    discountAmount,
    validate,
    applyPartnerPerk,
    remove,
    removePartnerPerk,
    clearError,
    isValidating: validateMutation.isPending,
    validationError,
  };
};
