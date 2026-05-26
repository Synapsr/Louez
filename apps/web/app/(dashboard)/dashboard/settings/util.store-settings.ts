import type { StoreSettings } from '@louez/types';

import { getTimezoneForCountry } from '@/lib/utils/countries';

export interface StoreSettingsInput {
  name: string;
  description?: string;
  email?: string;
  phone?: string;
  address?: string;
  country: string;
  currency: string;
  latitude?: number | null;
  longitude?: number | null;
  billingAddressSameAsStore: boolean;
  billingAddress?: string;
  billingCity?: string;
  billingPostalCode?: string;
  billingCountry?: string;
  reservationMode: 'payment' | 'request';
  pendingBlocksAvailability: boolean;
  onlinePaymentDepositPercentage: number;
  minRentalMinutes: number;
  maxRentalMinutes: number | null;
  advanceNoticeMinutes: number;
  turnoverBufferMinutes: number;
  requireCustomerAddress: boolean;
}

const DEFAULT_STORE_SETTINGS = {
  reservationMode: 'payment',
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 1440,
  turnoverBufferMinutes: 0,
} satisfies StoreSettings;

export function buildStoreSettingsUpdate(
  currentSettings: StoreSettings | null | undefined,
  data: StoreSettingsInput,
): StoreSettings {
  return {
    ...DEFAULT_STORE_SETTINGS,
    ...currentSettings,
    reservationMode: data.reservationMode,
    pendingBlocksAvailability: data.pendingBlocksAvailability,
    onlinePaymentDepositPercentage: data.onlinePaymentDepositPercentage,
    minRentalMinutes: data.minRentalMinutes,
    maxRentalMinutes: data.maxRentalMinutes,
    advanceNoticeMinutes: data.advanceNoticeMinutes,
    turnoverBufferMinutes: data.turnoverBufferMinutes,
    requireCustomerAddress: data.requireCustomerAddress,
    country: data.country,
    timezone: getTimezoneForCountry(data.country),
    currency: data.currency,
    billingAddress: {
      useSameAsStore: data.billingAddressSameAsStore,
      address: data.billingAddressSameAsStore ? undefined : data.billingAddress,
      city: data.billingAddressSameAsStore ? undefined : data.billingCity,
      postalCode: data.billingAddressSameAsStore
        ? undefined
        : data.billingPostalCode,
      country: data.billingAddressSameAsStore ? undefined : data.billingCountry,
    },
  };
}
