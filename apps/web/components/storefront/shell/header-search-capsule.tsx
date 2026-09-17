"use client";

import { HeaderSearchCapsuleView } from "@/components/storefront/shell/header-search-capsule-view";
import { useCartActions, useCartState } from "@/contexts/cart-context";
import { useStorefrontSearch } from "@/contexts/storefront-search-context";
import { parseRentalPeriod, type RentalPeriodRules } from "@/lib/utils/util.rental-period";

interface HeaderSearchCapsuleProps {
  rules: RentalPeriodRules;
  className?: string;
}

/** Connect the shared header controls to the storefront search and cart. */
export const HeaderSearchCapsule = ({ rules, className }: HeaderSearchCapsuleProps) => {
  const { draft, setDraft, clear, submit } = useStorefrontSearch();
  const { period } = useCartState();
  const { setPeriod, setPricingMode } = useCartActions();

  return (
    <HeaderSearchCapsuleView
      rules={rules}
      className={className}
      query={draft}
      period={period ? parseRentalPeriod(period.startDate, period.endDate) : null}
      onQueryChange={setDraft}
      onClear={clear}
      onSubmit={submit}
      onPeriodChange={(next) => {
        setPricingMode(rules.pricingMode);
        setPeriod(next.start.toISOString(), next.end.toISOString());
      }}
    />
  );
};
