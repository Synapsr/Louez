"use client";

import { useCallback } from "react";

import { formatCurrency } from "@louez/utils";

import { useStoreCurrency } from "@/contexts/store-context";
import { useFormatLocale } from "@/hooks/use-format-locale";

export interface FormatMoneyOptions {
  /** Overrides the store currency for the odd amount held in another one. */
  currency?: string;
  /** Digits after the decimal point; `0` for a range label or a slider, where cents are noise. */
  fractionDigits?: number;
}

/**
 * One money formatter for the storefront: store currency + the visitor's
 * format locale (`fr-FR` gives "32,00 €", `en-GB` gives "€32.00").
 *
 * Replaces the bare `formatCurrency(amount, currency)` calls that formatted
 * every price in the currency's home locale whatever the visitor's language.
 */
export const useFormatMoney = () => {
  const storeCurrency = useStoreCurrency();
  const { intl: formatLocale } = useFormatLocale();

  return useCallback(
    (amount: number, options?: FormatMoneyOptions): string =>
      formatCurrency(amount, options?.currency ?? storeCurrency, formatLocale, {
        fractionDigits: options?.fractionDigits,
      }),
    [formatLocale, storeCurrency],
  );
};
