import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isWithinMonthlyCap } from './cap';

test('a cap of 0 means unlimited — always within cap', () => {
  assert.equal(
    isWithinMonthlyCap({ rewardedThisMonth: 9999, monthlyCap: 0 }),
    true,
  );
});

test('below the cap is allowed', () => {
  assert.equal(isWithinMonthlyCap({ rewardedThisMonth: 9, monthlyCap: 10 }), true);
});

test('at the cap is denied (cap is a hard ceiling)', () => {
  assert.equal(
    isWithinMonthlyCap({ rewardedThisMonth: 10, monthlyCap: 10 }),
    false,
  );
});

test('above the cap is denied', () => {
  assert.equal(
    isWithinMonthlyCap({ rewardedThisMonth: 11, monthlyCap: 10 }),
    false,
  );
});

test('a negative cap is treated as unlimited', () => {
  assert.equal(
    isWithinMonthlyCap({ rewardedThisMonth: 50, monthlyCap: -1 }),
    true,
  );
});
