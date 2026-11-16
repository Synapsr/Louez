"use client";

import { useCallback } from "react";

import { useFormatMoney } from "@/hooks/use-format-money";

/**
 * An amount of the reservation as its page writes it: in the reservation's
 * currency and the user's format locale, by the app's money formatter, as
 * the items card writes its lines ("1 500 JPY", "12,00 €" in French). A
 * decimal string, as a payment row holds it, is read as its number.
 */
export const useReservationMoney = (currency: string) => {
  const formatMoney = useFormatMoney();
  return useCallback(
    (amount: number | string) =>
      formatMoney(typeof amount === "string" ? parseFloat(amount) : amount, { currency }),
    [formatMoney, currency],
  );
};
