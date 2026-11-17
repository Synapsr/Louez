"use client";

import { useStore } from "@/contexts/store-context";
import { useFormatLocale } from "@/hooks/use-format-locale";
import type { DisplayFormat } from "@/lib/inbox/needs-a-look-display";
import { formatCurrency } from "@/lib/utils";
import { formatStoreDate } from "@/lib/utils/store-date";

/** Money and days of what needs a look, as the dashboard writes them, in the store's time zone. */
export const useNeedsALookFormat = (): DisplayFormat => {
  const { timezone } = useStore();
  const { intl } = useFormatLocale();
  return {
    money: (amount, currency) => formatCurrency(Number(amount), currency, intl),
    day: (iso) => formatStoreDate(iso, timezone, "SHORTEST_DATE", intl),
  };
};
