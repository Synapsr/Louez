"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { HomePeriodSearchView } from "@/components/storefront/home/home-period-search-view";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { useCartActions, useCartState } from "@/contexts/cart-context";
import { useStorefrontBasePath } from "@/contexts/store-context";
import { resolveStorefrontHref } from "@/lib/util.storefront-href";
import { parseRentalPeriod, type RentalPeriodRules } from "@/lib/utils/util.rental-period";

type HomePeriodSearchTone = "floating" | "flat";

interface HomePeriodSearchProps {
  rules: RentalPeriodRules;
  /** `floating` casts the overlay shadow (on a photo or a band); `flat` is a bordered block on the page surface. */
  tone?: HomePeriodSearchTone;
}

/**
 * The hero's period search: two fields and one always-enabled CTA. The
 * period becomes the cart's, then the visitor lands on the catalog filtered
 * on those dates.
 */
export const HomePeriodSearch = ({ rules, tone = "floating" }: HomePeriodSearchProps) => {
  const router = useRouter();
  const basePath = useStorefrontBasePath() ?? "";
  const { period: cartPeriod } = useCartState();
  const { setPeriod } = useCartActions();
  const [value, setValue] = useState<RentalPeriodValue | null>(null);

  const shownValue =
    value ?? (cartPeriod ? parseRentalPeriod(cartPeriod.startDate, cartPeriod.endDate) : null);

  const search = (period: RentalPeriodValue) => {
    const startDate = period.start.toISOString();
    const endDate = period.end.toISOString();
    setPeriod(startDate, endDate);
    const params = new URLSearchParams({ startDate, endDate });
    router.push(resolveStorefrontHref(basePath, `/catalog?${params.toString()}`));
  };

  return (
    <HomePeriodSearchView
      rules={rules}
      tone={tone}
      value={shownValue}
      onChange={(period) => {
        setValue(period);
        search(period);
      }}
      onSubmit={search}
    />
  );
};
