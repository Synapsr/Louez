import assert from 'node:assert/strict';
import { test } from 'node:test';

import { qualifiesForReferralReward } from './qualification';

const MIN = 2000; // 20 € launch default

test('an online payment at the minimum (20 €) qualifies', () => {
  assert.equal(
    qualifiesForReferralReward({
      amountCents: 2000,
      channel: 'online',
      minQualifyingAmountCents: MIN,
    }),
    true,
  );
});

test('an online payment above the minimum qualifies', () => {
  assert.equal(
    qualifiesForReferralReward({
      amountCents: 8000,
      channel: 'online',
      minQualifyingAmountCents: MIN,
    }),
    true,
  );
});

test('an online payment below the minimum (19,99 €) does NOT qualify', () => {
  assert.equal(
    qualifiesForReferralReward({
      amountCents: 1999,
      channel: 'online',
      minQualifyingAmountCents: MIN,
    }),
    false,
  );
});

test('a manual reservation never qualifies, even well above the minimum', () => {
  assert.equal(
    qualifiesForReferralReward({
      amountCents: 50000,
      channel: 'manual',
      minQualifyingAmountCents: MIN,
    }),
    false,
  );
});

test('a zero or negative amount never qualifies', () => {
  assert.equal(
    qualifiesForReferralReward({
      amountCents: 0,
      channel: 'online',
      minQualifyingAmountCents: MIN,
    }),
    false,
  );
  assert.equal(
    qualifiesForReferralReward({
      amountCents: -100,
      channel: 'online',
      minQualifyingAmountCents: MIN,
    }),
    false,
  );
});

test('with the minimum disabled (0), any positive online payment qualifies', () => {
  assert.equal(
    qualifiesForReferralReward({
      amountCents: 1,
      channel: 'online',
      minQualifyingAmountCents: 0,
    }),
    true,
  );
});
