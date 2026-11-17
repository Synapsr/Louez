"use client";

import { useEffect, useMemo, useState } from "react";

import { getCustomerDiscountPreview } from "../actions";
import type { CheckoutInitialCustomer, CustomerDiscountState } from "../checkout.types";
import { calculateCustomerDiscountBreakdown } from "../util.checkout-totals";

interface UseCheckoutCustomerDiscountParams {
  storeId: string;
  email: string;
  sessionCustomer: CheckoutInitialCustomer | null;
  subtotal: number;
  promoDiscountAmount: number;
  deliveryFee: number;
  insuranceAmount: number;
  isConfirmStep: boolean;
}

export interface UseCheckoutCustomerDiscountResult extends CustomerDiscountState {
  totalDiscountAmount: number;
}

export const useCheckoutCustomerDiscount = ({
  storeId,
  email,
  sessionCustomer,
  subtotal,
  promoDiscountAmount,
  deliveryFee,
  insuranceAmount,
  isConfirmStep,
}: UseCheckoutCustomerDiscountParams): UseCheckoutCustomerDiscountResult => {
  const normalizedEmail = email.trim().toLowerCase();
  const sessionEmail = sessionCustomer?.email?.trim().toLowerCase() ?? "";
  const sessionDiscountPercent =
    normalizedEmail && normalizedEmail === sessionEmail
      ? (sessionCustomer?.discountPercent ?? 0)
      : 0;

  const [fetchedDiscount, setFetchedDiscount] = useState<{
    email: string;
    discountPercent: number;
  } | null>(null);

  useEffect(() => {
    if (!storeId || !normalizedEmail || !normalizedEmail.includes("@")) {
      return;
    }

    let cancelled = false;
    void getCustomerDiscountPreview({ storeId, email: normalizedEmail })
      .then((res) => {
        if (!cancelled) {
          setFetchedDiscount({
            email: normalizedEmail,
            discountPercent: res.discountPercent,
          });
        }
      })
      .catch(() => {
        // Fallback to session discount or 0
      });

    return () => {
      cancelled = true;
    };
  }, [storeId, normalizedEmail, isConfirmStep]);

  const resolvedCustomerPercent =
    fetchedDiscount?.email === normalizedEmail
      ? fetchedDiscount.discountPercent
      : sessionDiscountPercent;

  // Customer discount applies only on the "Confirm" ("Potwierdzenie") step
  const activeDiscountPercent = isConfirmStep ? resolvedCustomerPercent : 0;

  return useMemo(
    () =>
      calculateCustomerDiscountBreakdown({
        subtotal,
        promoDiscountAmount,
        customerDiscountPercent: activeDiscountPercent,
        deliveryFee,
        insuranceAmount,
      }),
    [subtotal, promoDiscountAmount, activeDiscountPercent, deliveryFee, insuranceAmount],
  );
};
