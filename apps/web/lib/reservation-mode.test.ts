import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getEffectiveReservationMode,
  getReservationConfirmationVariant,
  isPaymentModeDegraded,
} from './reservation-mode';

test('degrades payment intent to a request until Stripe is chargeable', () => {
  assert.equal(
    getEffectiveReservationMode({
      settings: { reservationMode: 'payment' },
      stripeAccountId: null,
      stripeChargesEnabled: false,
    }),
    'request',
  );
});

test('keeps payment mode when Stripe is chargeable', () => {
  assert.equal(
    getEffectiveReservationMode({
      settings: { reservationMode: 'payment' },
      stripeAccountId: 'acct_test',
      stripeChargesEnabled: true,
    }),
    'payment',
  );
});

test('presents a pending payment-mode reservation as a request, not confirmed', () => {
  assert.equal(getReservationConfirmationVariant('pending'), 'request');
});

test('presents accepted and active reservations as confirmed', () => {
  assert.equal(getReservationConfirmationVariant('confirmed'), 'confirmed');
  assert.equal(getReservationConfirmationVariant('ongoing'), 'confirmed');
  assert.equal(getReservationConfirmationVariant('completed'), 'confirmed');
});

test('a demo store takes its simulated payment online without Stripe, and is not degraded', () => {
  const store = {
    settings: { reservationMode: 'payment' as const },
    stripeAccountId: null,
    stripeChargesEnabled: false,
    demoVertical: 'ski',
  };
  assert.equal(getEffectiveReservationMode(store), 'payment');
  assert.equal(isPaymentModeDegraded(store), false);
  assert.equal(
    getEffectiveReservationMode({ ...store, settings: { reservationMode: 'request' as const } }),
    'request',
  );
});
