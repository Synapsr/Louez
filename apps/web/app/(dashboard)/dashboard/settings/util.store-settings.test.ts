import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { StoreSettings } from '@louez/types';

import {
  type StoreSettingsInput,
  buildStoreSettingsUpdate,
} from './util.store-settings';

const input = {
  name: 'Location Pro',
  country: 'FR',
  currency: 'EUR',
  billingAddressSameAsStore: true,
  reservationMode: 'payment',
  pendingBlocksAvailability: true,
  onlinePaymentDepositPercentage: 100,
  minRentalMinutes: 120,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 2880,
  turnoverBufferMinutes: 30,
  requireCustomerAddress: false,
} satisfies StoreSettingsInput;

test('general settings update preserves delivery settings', () => {
  const currentSettings = {
    reservationMode: 'request',
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 1440,
    turnoverBufferMinutes: 0,
    delivery: {
      enabled: true,
      multiLocationEnabled: true,
      mode: 'required',
      pricePerKm: 2.5,
      minimumFee: 15,
      maximumDistance: 40,
      freeDeliveryThreshold: 200,
      minimumOrderAmountForDelivery: 50,
    },
  } satisfies StoreSettings;

  const nextSettings = buildStoreSettingsUpdate(currentSettings, input);

  assert.deepEqual(nextSettings.delivery, currentSettings.delivery);
  assert.equal(nextSettings.reservationMode, 'payment');
  assert.equal(nextSettings.minRentalMinutes, 120);
});

test('general settings update preserves unrelated settings branches', () => {
  const currentSettings = {
    reservationMode: 'payment',
    minRentalMinutes: 60,
    maxRentalMinutes: null,
    advanceNoticeMinutes: 1440,
    turnoverBufferMinutes: 0,
    inspection: {
      enabled: true,
      mode: 'required',
      requireCustomerSignature: true,
      autoGeneratePdf: true,
      maxPhotosPerItem: 8,
    },
    integrationData: {
      states: {
        'google-calendar': { enabled: true },
      },
    },
  } satisfies StoreSettings;

  const nextSettings = buildStoreSettingsUpdate(currentSettings, input);

  assert.deepEqual(nextSettings.inspection, currentSettings.inspection);
  assert.deepEqual(
    nextSettings.integrationData,
    currentSettings.integrationData,
  );
});
