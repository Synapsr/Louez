"use client";

import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";

import type { CartItem } from "@/contexts/cart-context";
import { checkoutQueries } from "@/lib/queries/checkout.queries";

import type {
  CheckoutFormValues,
  CheckoutTulipInsurance,
  TulipInsuranceMode,
  TulipQuoteCustomer,
  TulipQuotePreview,
  TulipQuotePreviewInput,
} from "../checkout.types";

const TULIP_QUOTE_FAILED_ERROR = "errors.tulipQuoteFailed";

interface UseCheckoutTulipQuoteParams {
  storeId: string;
  tulipInsurance?: CheckoutTulipInsurance;
  /** Start once cart lines are resolved. */
  isActive: boolean;
  items: CartItem[];
  startDate: string | null;
  endDate: string | null;
  values: CheckoutFormValues;
  requireCustomerAddress: boolean;
}

const createEmptyPreview = (mode: TulipInsuranceMode): TulipQuotePreview => ({
  mode,
  connected: false,
  inclusionEnabled: false,
  quoteUnavailable: false,
  quoteError: null,
  requestedOptIn: false,
  appliedOptIn: false,
  amount: 0,
  insuredProductCount: 0,
  uninsuredProductCount: 0,
  insuredProductIds: [],
  error: null,
});

/**
 * Live Tulip premium for the cart. Returns an empty preview while the quote
 * does not apply (mode `no_public`, unresolved cart, no dates) and a degraded
 * one when the quote request itself fails.
 */
export const useCheckoutTulipQuote = ({
  storeId,
  tulipInsurance,
  isActive,
  items,
  startDate,
  endDate,
  values,
  requireCustomerAddress,
}: UseCheckoutTulipQuoteParams) => {
  const mode: TulipInsuranceMode = tulipInsurance?.mode ?? "no_public";
  const {
    isBusinessCustomer,
    companyName,
    firstName,
    lastName,
    email,
    phone,
    address,
    city,
    postalCode,
    tulipInsuranceOptIn,
  } = values;

  const customer = useMemo<TulipQuoteCustomer>(
    () => ({
      customerType: isBusinessCustomer ? "business" : "individual",
      companyName: isBusinessCustomer ? companyName : undefined,
      firstName,
      lastName,
      email,
      phone,
      address: requireCustomerAddress ? address : undefined,
      city: requireCustomerAddress ? city : undefined,
      postalCode: requireCustomerAddress ? postalCode : undefined,
    }),
    [
      address,
      city,
      companyName,
      email,
      firstName,
      isBusinessCustomer,
      lastName,
      phone,
      postalCode,
      requireCustomerAddress,
    ],
  );

  const quoteItems = useMemo(
    () =>
      items
        .map((item) => ({ productId: item.productId, quantity: item.quantity }))
        .sort(
          (left, right) =>
            left.productId.localeCompare(right.productId) || left.quantity - right.quantity,
        ),
    [items],
  );

  const request = useMemo<TulipQuotePreviewInput | null>(() => {
    if (!tulipInsurance?.enabled || mode === "no_public" || !isActive || !startDate || !endDate) {
      return null;
    }
    if (quoteItems.length === 0) {
      return null;
    }
    // The quote is always requested with the cover on so the customer sees the
    // premium next to the switch; whether it is charged follows the switch.
    return { storeId, customer, items: quoteItems, startDate, endDate, tulipInsuranceOptIn: true };
  }, [customer, endDate, isActive, mode, quoteItems, startDate, storeId, tulipInsurance?.enabled]);

  const [debouncedCustomer] = useDebounce(customer, 500);
  const isCustomerPending = customer !== debouncedCustomer;

  const query = useQuery({
    ...checkoutQueries.tulipQuote(
      request ?? { storeId, customer, items: [], startDate: "", endDate: "" },
    ),
    enabled: request !== null && !isCustomerPending,
  });

  const preview = useMemo<TulipQuotePreview>(() => {
    if (!request) return createEmptyPreview(mode);
    if (query.data) return query.data;
    if (query.isError) {
      return {
        ...createEmptyPreview(mode),
        quoteUnavailable: true,
        quoteError: TULIP_QUOTE_FAILED_ERROR,
        error: TULIP_QUOTE_FAILED_ERROR,
      };
    }
    return createEmptyPreview(mode);
  }, [mode, query.data, query.isError, request]);

  const isLoading =
    request !== null && (isCustomerPending || query.isLoading || (query.isFetching && !query.data));
  const isFetched = query.data !== undefined || query.isError;
  const quotedAmount = preview.appliedOptIn && preview.amount > 0 ? preview.amount : 0;
  const isCoverSelected = mode === "required" || tulipInsuranceOptIn;
  const appliedAmount = isCoverSelected ? quotedAmount : 0;
  const isRequiredAndFailed =
    Boolean(tulipInsurance?.enabled) && preview.mode === "required" && Boolean(preview.error);

  return { mode, preview, isLoading, isFetched, quotedAmount, appliedAmount, isRequiredAndFailed };
};
