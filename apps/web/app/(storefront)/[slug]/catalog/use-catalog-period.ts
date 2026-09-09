"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import type { ProductCardPeriod } from "@/components/storefront/product/util.product-card";
import { useCartActions, useCartState } from "@/contexts/cart-context";
import type { PricingMode } from "@/lib/utils/duration";
import { type CatalogFilters, type CatalogFiltersPatch } from "@/lib/utils/util.rental-browse";
import { parseRentalPeriod } from "@/lib/utils/util.rental-period";

interface UseCatalogPeriodOptions {
  filters: Pick<CatalogFilters, "startDate" | "endDate">;
  update: (patch: CatalogFiltersPatch) => void;
  pricingMode: PricingMode;
}

export interface CatalogPeriod {
  /** What the chip and the calendar show. */
  value: RentalPeriodValue | null;
  /** The same period as ISO strings, for cards, links and availability. */
  period: ProductCardPeriod | null;
  setPeriod: (next: RentalPeriodValue) => void;
}

/**
 * One rental period for the catalog: the URL's when it carries one, else
 * the cart's. Picking dates updates both, so the product page and the
 * drawer see the same period.
 *
 * The header's picker only writes the cart — it sits in the layout and has
 * no idea a catalog is mounted — so a change made up there is mirrored into
 * the URL here. On arrival a URL that carries dates wins, or a shared link
 * would be overwritten by whatever the cart happened to be holding; a URL
 * without dates takes the cart's, so the server page (its prices, its
 * bounds) is rendered for the period the cards already show.
 */
export const useCatalogPeriod = ({
  filters,
  update,
  pricingMode,
}: UseCatalogPeriodOptions): CatalogPeriod => {
  const { period: cartPeriod } = useCartState();
  const { setPeriod: setCartPeriod, setPricingMode } = useCartActions();

  const urlStart = filters.startDate;
  const urlEnd = filters.endDate;
  const cartStart = cartPeriod?.startDate ?? null;
  const cartEnd = cartPeriod?.endDate ?? null;

  const value = useMemo(
    () => parseRentalPeriod(urlStart, urlEnd) ?? parseRentalPeriod(cartStart, cartEnd),
    [urlStart, urlEnd, cartStart, cartEnd],
  );

  const period = useMemo<ProductCardPeriod | null>(
    () =>
      value ? { startDate: value.start.toISOString(), endDate: value.end.toISOString() } : null,
    [value],
  );

  const cartKey = cartStart && cartEnd ? `${cartStart}/${cartEnd}` : null;
  // A URL without dates adopts the cart's on arrival; afterwards only a
  // change of the cart period is mirrored.
  const lastCartKey = useRef(urlStart && urlEnd ? cartKey : null);

  useEffect(() => {
    if (cartKey === lastCartKey.current) {
      return;
    }

    lastCartKey.current = cartKey;

    if (!cartStart || !cartEnd || (cartStart === urlStart && cartEnd === urlEnd)) {
      return;
    }

    update({ startDate: cartStart, endDate: cartEnd });
  }, [cartEnd, cartKey, cartStart, update, urlEnd, urlStart]);

  const setPeriod = useCallback(
    (next: RentalPeriodValue) => {
      const startDate = next.start.toISOString();
      const endDate = next.end.toISOString();
      setPricingMode(pricingMode);
      setCartPeriod(startDate, endDate);
      update({ startDate, endDate });
    },
    [pricingMode, setCartPeriod, setPricingMode, update],
  );

  return { value, period, setPeriod };
};
