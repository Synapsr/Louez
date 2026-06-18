import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeReferrerReward } from './reward';

// Entry-tier pay-as-you-go price: 1 € per reservation.
const UNIT = 100;

test('a pay-as-you-go referrer earns 30 free reservations (≈ 30 €)', () => {
  const reward = computeReferrerReward({
    billingMode: 'pay_as_you_go',
    freeReservations: 30,
    unitValueCents: UNIT,
  });
  assert.equal(reward.kind, 'free_reservations');
  assert.equal(reward.freeReservations, 30);
  assert.equal(reward.creditCents, 0);
  assert.equal(reward.displayValueCents, 3000);
});

test('a subscribed referrer earns the equivalent euro credit instead of free reservations', () => {
  const reward = computeReferrerReward({
    billingMode: 'subscription',
    freeReservations: 30,
    unitValueCents: UNIT,
  });
  assert.equal(reward.kind, 'invoice_credit');
  assert.equal(reward.freeReservations, 0);
  assert.equal(reward.creditCents, 3000);
  assert.equal(reward.displayValueCents, 3000);
});

test('both billing modes display the same monetary value', () => {
  const payg = computeReferrerReward({
    billingMode: 'pay_as_you_go',
    freeReservations: 30,
    unitValueCents: UNIT,
  });
  const sub = computeReferrerReward({
    billingMode: 'subscription',
    freeReservations: 30,
    unitValueCents: UNIT,
  });
  assert.equal(payg.displayValueCents, sub.displayValueCents);
});

test('display value follows the referrer applicable tariff, not a flat 1 €', () => {
  const reward = computeReferrerReward({
    billingMode: 'pay_as_you_go',
    freeReservations: 30,
    unitValueCents: 80, // a 0,80 € tariff
  });
  assert.equal(reward.displayValueCents, 2400);
});

test('a zero-size reward yields nothing of value', () => {
  const reward = computeReferrerReward({
    billingMode: 'pay_as_you_go',
    freeReservations: 0,
    unitValueCents: UNIT,
  });
  assert.equal(reward.freeReservations, 0);
  assert.equal(reward.displayValueCents, 0);
});
