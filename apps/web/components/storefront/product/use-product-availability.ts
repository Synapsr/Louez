"use client";

import { useMemo } from "react";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { CombinationAvailability } from "@louez/types";
import type { StockQuantityLimit } from "@louez/utils";
import type { StorefrontProductAvailability } from "@louez/validations";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";

import { storefrontQueries } from "@/lib/queries/storefront.queries";

export interface ProductAvailability {
  /** Stock for the period, `undefined` until the call answers for a chosen period. */
  maxQuantity: StockQuantityLimit | undefined;
  /** Per-combination stock for the period; `undefined` until known. */
  combinations: CombinationAvailability[] | undefined;
  /** True while a period is being checked (the previous answer stays on screen). */
  isChecking: boolean;
}

const readCombinations = (availability: StorefrontProductAvailability): CombinationAvailability[] =>
  availability.combinationsByKey
    ? Object.values(availability.combinationsByKey)
    : (availability.combinations ?? []);

/**
 * Stock of one product for a period. While a new period loads, the last
 * answer is kept (`keepPreviousData`) so the quantity stepper never snaps
 * to zero between two selections.
 */
export const useProductAvailability = (
  productId: string,
  period: RentalPeriodValue | null,
): ProductAvailability => {
  const query = useQuery({
    ...storefrontQueries.availability({
      startDate: period?.start.toISOString() ?? "",
      endDate: period?.end.toISOString() ?? "",
      productIds: [productId],
    }),
    enabled: period !== null,
    placeholderData: keepPreviousData,
  });

  const productAvailability = useMemo(
    () =>
      period && query.data
        ? (query.data.products.find((item) => item.productId === productId) ?? null)
        : null,
    [period, productId, query.data],
  );

  return useMemo<ProductAvailability>(
    () => ({
      maxQuantity: productAvailability ? productAvailability.availableQuantity : undefined,
      combinations: productAvailability ? readCombinations(productAvailability) : undefined,
      isChecking: period !== null && query.isFetching,
    }),
    [period, productAvailability, query.isFetching],
  );
};
