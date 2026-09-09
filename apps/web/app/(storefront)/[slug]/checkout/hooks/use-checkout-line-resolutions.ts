"use client";

import { useMemo } from "react";

import { useQueries } from "@tanstack/react-query";

import type { CartItem } from "@/contexts/cart-context";
import { storefrontQueries } from "@/lib/queries/storefront.queries";

import type { LineResolutionState } from "../checkout.types";

interface UseCheckoutLineResolutionsParams {
  items: CartItem[];
}

/**
 * Resolves every cart line to a concrete attribute combination (the unit the
 * server will reserve). One query per line, cached with the storefront
 * availability queries so a line already resolved on the product page is
 * free here.
 */
export const useCheckoutLineResolutions = ({ items }: UseCheckoutLineResolutionsParams) => {
  const resolutions = useQueries({
    queries: items.map((item) => ({
      ...storefrontQueries.resolveCombination({
        productId: item.productId,
        quantity: item.quantity,
        startDate: item.startDate,
        endDate: item.endDate,
        selectedAttributes: item.selectedAttributes,
      }),
      retry: false,
    })),
  });

  return useMemo(() => {
    const lineResolutions: Record<string, LineResolutionState> = {};
    const itemsWithResolved: CartItem[] = [];
    let hasInvalidLines = false;
    let hasUnresolvedLines = false;

    items.forEach((item, index) => {
      const query = resolutions[index];

      if (!query || query.isPending) {
        lineResolutions[item.lineId] = { status: "loading" };
        hasUnresolvedLines = true;
        itemsWithResolved.push(item);
        return;
      }

      if (query.isError || !query.data) {
        lineResolutions[item.lineId] = { status: "invalid" };
        hasInvalidLines = true;
        itemsWithResolved.push(item);
        return;
      }

      lineResolutions[item.lineId] = {
        status: "resolved",
        combinationKey: query.data.combinationKey,
        selectedAttributes: query.data.selectedAttributes,
      };
      itemsWithResolved.push({
        ...item,
        resolvedCombinationKey: query.data.combinationKey,
        resolvedAttributes: query.data.selectedAttributes,
      });
    });

    return {
      lineResolutions,
      itemsWithResolved,
      hasInvalidLines,
      hasUnresolvedLines,
      canSubmitCheckout: !hasInvalidLines && !hasUnresolvedLines,
    };
  }, [items, resolutions]);
};
