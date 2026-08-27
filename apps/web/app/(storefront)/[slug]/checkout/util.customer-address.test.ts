import assert from 'node:assert/strict';
import test from 'node:test';

import type { AddressDetails } from '@louez/types';

import { getCustomerAddressFields } from './util.customer-address';

const baseDetails = {
  placeId: 'place-1',
  formattedAddress: '8 Quai de la Douane, 29200 Brest, France',
  latitude: 48.383,
  longitude: -4.49,
} satisfies AddressDetails;

test('uses the street line and pre-fills the postal code and city', () => {
  assert.deepEqual(
    getCustomerAddressFields({
      ...baseDetails,
      streetNumber: '8',
      street: 'Quai de la Douane',
      postalCode: '29200',
      city: 'Brest',
    }),
    {
      address: '8 Quai de la Douane',
      postalCode: '29200',
      city: 'Brest',
    },
  );
});

test('falls back to the formatted address and clears unavailable locality fields', () => {
  assert.deepEqual(getCustomerAddressFields(baseDetails), {
    address: '8 Quai de la Douane, 29200 Brest, France',
    postalCode: '',
    city: '',
  });
});
