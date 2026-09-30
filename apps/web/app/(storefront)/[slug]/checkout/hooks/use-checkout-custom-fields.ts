"use client";

import { useCallback, useMemo } from "react";

import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CartItem } from "@/contexts/cart-context";
import { orpc } from "@/lib/orpc/react";

import type { CheckoutFieldsPlans } from "../checkout.types";
import { buildCheckoutFieldsPlan } from "../util.checkout-custom-fields";

/** What a store asks only changes when its owner edits the settings. */
const CUSTOM_FIELDS_STALE_TIME = 60_000;

/** `storefront.customerFields.forCart` takes at most this many lines. */
const MAX_LINES = 50;

interface UseCheckoutCustomFieldsParams {
  /** Cart lines in checkout order: their index is the payload's `lineIndex`. */
  items: CartItem[];
}

/**
 * What the store asks this cart: customer fields for the contact step, item
 * fields per rented unit for "Détails de la location". Both buyer types are
 * fetched up front (`appliesTo` differs, and the public answer does not say
 * it), so ticking "Je commande pour une entreprise" never waits on the network.
 */
export const useCheckoutCustomFields = ({ items }: UseCheckoutCustomFieldsParams) => {
  const queryClient = useQueryClient();
  const lines = items.map((item) => ({ productId: item.productId, quantity: item.quantity }));
  const enabled = lines.length > 0 && lines.length <= MAX_LINES;

  const individual = useQuery(
    orpc.storefront.customerFields.forCart.queryOptions({
      input: { lines, customerType: "individual" },
      enabled,
      placeholderData: keepPreviousData,
      staleTime: CUSTOM_FIELDS_STALE_TIME,
    }),
  );
  const business = useQuery(
    orpc.storefront.customerFields.forCart.queryOptions({
      input: { lines, customerType: "business" },
      enabled,
      placeholderData: keepPreviousData,
      staleTime: CUSTOM_FIELDS_STALE_TIME,
    }),
  );

  const plans = useMemo<CheckoutFieldsPlans>(
    () => ({
      individual: buildCheckoutFieldsPlan(individual.data, items),
      business: buildCheckoutFieldsPlan(business.data, items),
    }),
    [business.data, individual.data, items],
  );

  /** The server refused values: the store may have changed its rules since the page loaded. */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: orpc.storefront.customerFields.forCart.key(),
    });
  }, [queryClient]);

  return {
    plans,
    /** First answer still on its way: the contact step waits for it before moving on. */
    isLoading: enabled && (individual.isPending || business.isPending),
    refresh,
  };
};
