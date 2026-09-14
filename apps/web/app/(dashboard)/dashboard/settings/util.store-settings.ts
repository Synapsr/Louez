import type { StoreSettings } from "@louez/types";

import { getTimezoneForCountry } from "@/lib/utils/countries";

export interface CompanySettingsInput {
  country: string;
  currency: string;
  billingAddressSameAsStore: boolean;
  billingAddress?: string;
  billingCity?: string;
  billingPostalCode?: string;
  billingCountry?: string;
}

export interface ReservationRulesInput {
  reservationMode: "payment" | "request";
  pendingBlocksAvailability: boolean;
  automaticExtensions: boolean;
  maxExtensionDays: number | null;
  onlinePaymentDepositPercentage: number;
  minRentalMinutes: number;
  maxRentalMinutes: number | null;
  advanceNoticeMinutes: number;
  turnoverBufferMinutes: number;
  requireCustomerAddress: boolean;
}

/** The required keys, for a store that was created before it had any settings. */
const DEFAULT_STORE_SETTINGS = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 1440,
  turnoverBufferMinutes: 0,
} satisfies StoreSettings;

/**
 * Country, timezone, currency and billing address from the company page.
 * Every other settings key is carried over untouched.
 */
export function buildCompanySettingsUpdate(
  currentSettings: StoreSettings | null | undefined,
  input: CompanySettingsInput,
): StoreSettings {
  return {
    ...DEFAULT_STORE_SETTINGS,
    ...currentSettings,
    country: input.country,
    timezone: getTimezoneForCountry(input.country),
    currency: input.currency,
    billingAddress: {
      useSameAsStore: input.billingAddressSameAsStore,
      address: input.billingAddressSameAsStore ? undefined : input.billingAddress,
      city: input.billingAddressSameAsStore ? undefined : input.billingCity,
      postalCode: input.billingAddressSameAsStore ? undefined : input.billingPostalCode,
      country: input.billingAddressSameAsStore ? undefined : input.billingCountry,
    },
  };
}

/**
 * The booking rules from the reservations page. Every other settings key
 * (company, delivery, tax, storefront content...) is carried over untouched.
 */
export function buildReservationRulesUpdate(
  currentSettings: StoreSettings | null | undefined,
  input: ReservationRulesInput,
): StoreSettings {
  return {
    ...DEFAULT_STORE_SETTINGS,
    ...currentSettings,
    reservationMode: input.reservationMode,
    pendingBlocksAvailability: input.pendingBlocksAvailability,
    automaticExtensions: input.automaticExtensions,
    maxExtensionDays: input.maxExtensionDays,
    onlinePaymentDepositPercentage: input.onlinePaymentDepositPercentage,
    minRentalMinutes: input.minRentalMinutes,
    maxRentalMinutes: input.maxRentalMinutes,
    advanceNoticeMinutes: input.advanceNoticeMinutes,
    turnoverBufferMinutes: input.turnoverBufferMinutes,
    requireCustomerAddress: input.requireCustomerAddress,
  };
}
