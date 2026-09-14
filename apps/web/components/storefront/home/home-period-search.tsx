"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { cn } from "@louez/utils";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { RentalPeriodPicker } from "@/components/storefront/date-picker/rental-period-picker";
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

const TONE_CLASS_NAMES: Record<HomePeriodSearchTone, string> = {
  floating: "shadow-overlay",
  flat: "border",
};

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
    <div
      className={cn(
        "w-full max-w-2xl rounded-2xl bg-card p-4 text-card-foreground sm:p-5",
        TONE_CLASS_NAMES[tone],
      )}
      data-slot="home-period-search"
    >
      <RentalPeriodPicker
        layout="inline"
        value={shownValue}
        onChange={(period) => {
          setValue(period);
          search(period);
        }}
        onSubmit={search}
        rules={rules}
        showTimezoneNotice
      />
    </div>
  );
};
