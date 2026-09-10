"use client";

import { useCallback, useMemo, useState } from "react";

import { useMutation } from "@tanstack/react-query";

import type { CartItem } from "@/contexts/cart-context";
import { checkoutMutations } from "@/lib/queries/checkout.queries";

import type { ValidatedPromo } from "../checkout.types";

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
 * Promo code state for the checkout. The server reprices the cart and caps
 * the discount; the client only re-derives the amount from the promo type
 * when the subtotal moves, and drops a promo whose minimum is no longer met.
 */
export const useCheckoutPromo = ({ items, subtotal }: UseCheckoutPromoParams) => {
  const [appliedPromo, setAppliedPromo] = useState<ValidatedPromo | null>(null);
  const [validationError, setValidationError] = useState<PromoValidationError | null>(null);

  const validateMutation = useMutation({
    ...checkoutMutations.validatePromo(),
    onSuccess: (result) => {
      if (!result.ok) {
        setValidationError({ key: result.error, params: result.errorParams });
        return;
      }
      setValidationError(null);
      setAppliedPromo(result.promo);
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

  const remove = useCallback(() => {
    setAppliedPromo(null);
    setValidationError(null);
  }, []);

  const clearError = useCallback(() => setValidationError(null), []);

  // Derived, not synced: a promo whose minimum is no longer met simply stops
  // applying; the summary shows it as gone.
  const promo = useMemo(() => {
    if (!appliedPromo) return null;
    if (appliedPromo.minimumAmount > 0 && subtotal < appliedPromo.minimumAmount) {
      return null;
    }
    return appliedPromo;
  }, [appliedPromo, subtotal]);

  const discountAmount = useMemo(() => {
    if (!promo) return 0;
    const raw =
      promo.type === "percentage"
        ? Math.min((subtotal * promo.value) / 100, subtotal)
        : Math.min(promo.value, subtotal);
    return Math.round(raw * 100) / 100;
  }, [promo, subtotal]);

  return {
    promo,
    discountAmount,
    validate,
    remove,
    clearError,
    isValidating: validateMutation.isPending,
    validationError,
  };
};
