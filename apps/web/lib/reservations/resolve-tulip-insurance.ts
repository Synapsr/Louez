import type { TulipPublicMode } from "@louez/types";

import { log } from "@/lib/evlog";
import {
  getTulipCoverageSummary,
  previewTulipQuoteForCheckout,
} from "@/lib/integrations/tulip/contracts";
import { resolveTulipIntegrationForStore } from "@/lib/integrations/tulip/state";

export interface TulipInsuranceCustomer {
  customerType?: "individual" | "business";
  companyName?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  postalCode?: string;
}

export interface ResolveTulipInsuranceInput {
  storeId: string;
  modeOverride?: TulipPublicMode;
  customer: TulipInsuranceCustomer;
  items: Array<{ productId: string; quantity: number }>;
  startDate: Date;
  endDate: Date;
  tulipInsuranceOptIn?: boolean;
  fallbackCountry: string;
}

export interface TulipInsuranceResolution {
  mode: TulipPublicMode;
  connected: boolean;
  inclusionEnabled: boolean;
  quoteUnavailable: boolean;
  quoteError: string | null;
  requestedOptIn: boolean;
  appliedOptIn: boolean;
  amount: number;
  insuredProductCount: number;
  uninsuredProductCount: number;
  insuredProductIds: string[];
}

const getErrorKey = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.startsWith("errors.") ? error.message : fallback;

/**
 * Required mode forces the opt-in; optional mode follows the caller and only
 * an explicit `false` declines (a missing field keeps insurance, as before).
 */
export const getRequestedTulipOptIn = (
  mode: TulipPublicMode,
  optIn: boolean | undefined,
): boolean => (mode === "required" ? true : mode === "optional" ? optIn !== false : false);

export const getTulipCheckoutMode = async (
  storeId: string,
  modeOverride?: TulipPublicMode,
): Promise<{ mode: TulipPublicMode; connected: boolean }> => {
  const tulipSettings = (await resolveTulipIntegrationForStore(storeId)).settings;
  const connected = tulipSettings.enabled;
  return {
    mode: connected ? (modeOverride ?? tulipSettings.publicMode) : "no_public",
    connected,
  };
};

/**
 * Tulip quote for the checkout. Required mode: a failed quote blocks (throws
 * the error key). Optional mode: a failed quote degrades to no insurance.
 * Inclusion (premium borne by the store) yields a 0 amount.
 */
export const resolveTulipInsurance = async (
  input: ResolveTulipInsuranceInput,
): Promise<TulipInsuranceResolution> => {
  const modeInfo = await getTulipCheckoutMode(input.storeId, input.modeOverride);
  const requestedOptIn = getRequestedTulipOptIn(modeInfo.mode, input.tulipInsuranceOptIn);

  if (modeInfo.mode === "no_public") {
    return {
      mode: modeInfo.mode,
      connected: modeInfo.connected,
      inclusionEnabled: false,
      quoteUnavailable: false,
      quoteError: null,
      requestedOptIn,
      appliedOptIn: false,
      amount: 0,
      insuredProductCount: 0,
      uninsuredProductCount: 0,
      insuredProductIds: [],
    };
  }

  try {
    const preview = await previewTulipQuoteForCheckout({
      storeId: input.storeId,
      modeOverride: modeInfo.mode,
      customer: {
        customerType: input.customer.customerType || "individual",
        companyName: input.customer.companyName || null,
        firstName: input.customer.firstName,
        lastName: input.customer.lastName,
        email: input.customer.email,
        phone: input.customer.phone || "",
        address: input.customer.address || "",
        city: input.customer.city || "",
        postalCode: input.customer.postalCode || "",
        country: input.fallbackCountry,
      },
      items: input.items,
      startDate: input.startDate,
      endDate: input.endDate,
      optIn: requestedOptIn,
    });

    const inclusionEnabled = preview.inclusionEnabled === true;
    const amount =
      !inclusionEnabled &&
      preview.shouldApply &&
      Number.isFinite(preview.amount) &&
      preview.amount > 0
        ? Math.round(preview.amount * 100) / 100
        : 0;
    const appliedOptIn = requestedOptIn && preview.shouldApply;

    log.info({
      tulip: {
        event: "checkout_quote_resolved",
        storeId: input.storeId,
        mode: modeInfo.mode,
        requestedOptIn,
        appliedOptIn,
        amount,
        inclusionEnabled,
        insuredProductCount: preview.insuredProductCount,
        uninsuredProductCount: preview.uninsuredProductCount,
      },
    });

    return {
      mode: modeInfo.mode,
      connected: modeInfo.connected,
      inclusionEnabled,
      quoteUnavailable: false,
      quoteError: null,
      requestedOptIn,
      appliedOptIn,
      amount,
      insuredProductCount: preview.insuredProductCount,
      uninsuredProductCount: preview.uninsuredProductCount,
      insuredProductIds: preview.insuredProductIds,
    };
  } catch (error) {
    const errorKey = getErrorKey(error, "errors.tulipQuoteFailed");
    if (modeInfo.mode === "optional") {
      const coverage = await getTulipCoverageSummary(input.items);
      log.warn({
        tulip: {
          event: "checkout_quote_optional_fallback",
          storeId: input.storeId,
          mode: modeInfo.mode,
          requestedOptIn,
          error: errorKey,
          insuredProductCount: coverage.insuredProductCount,
          uninsuredProductCount: coverage.uninsuredProductCount,
        },
      });

      return {
        mode: modeInfo.mode,
        connected: modeInfo.connected,
        inclusionEnabled: false,
        quoteUnavailable: true,
        quoteError: errorKey,
        requestedOptIn,
        appliedOptIn: false,
        amount: 0,
        insuredProductCount: coverage.insuredProductCount,
        uninsuredProductCount: coverage.uninsuredProductCount,
        insuredProductIds: coverage.insuredProductIds,
      };
    }

    log.error({
      tulip: {
        event: "checkout_quote_required_failed",
        storeId: input.storeId,
        mode: modeInfo.mode,
        error: errorKey,
      },
    });
    throw new Error(errorKey);
  }
};
