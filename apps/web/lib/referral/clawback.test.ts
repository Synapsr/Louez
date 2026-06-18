import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeFreeReservationClawback,
  isWithinClawbackWindow,
} from './clawback';

test('a fully unused reward is clawed back in full', () => {
  const result = computeFreeReservationClawback({
    rewardFreeReservations: 30,
    grantedTotal: 45, // 15 welcome + 30 reward
    usedTotal: 0,
  });
  assert.deepEqual(result, { revoke: 30, newGrantedTotal: 15 });
});

test('only the not-yet-consumed part of the reward is revoked', () => {
  // 45 granted, 40 already consumed -> only 5 are revocable.
  const result = computeFreeReservationClawback({
    rewardFreeReservations: 30,
    grantedTotal: 45,
    usedTotal: 40,
  });
  assert.deepEqual(result, { revoke: 5, newGrantedTotal: 40 });
});

test('nothing is revoked once everything is consumed (no un-waiving past rentals)', () => {
  const result = computeFreeReservationClawback({
    rewardFreeReservations: 30,
    grantedTotal: 45,
    usedTotal: 45,
  });
  assert.deepEqual(result, { revoke: 0, newGrantedTotal: 45 });
});

test('a reversal inside the 30-day window is clawed back', () => {
  assert.equal(
    isWithinClawbackWindow({
      grantedAt: new Date('2026-06-01T00:00:00Z'),
      eventAt: new Date('2026-06-20T00:00:00Z'),
      clawbackWindowDays: 30,
    }),
    true,
  );
});

test('a reversal after the window is NOT clawed back', () => {
  assert.equal(
    isWithinClawbackWindow({
      grantedAt: new Date('2026-06-01T00:00:00Z'),
      eventAt: new Date('2026-07-15T00:00:00Z'),
      clawbackWindowDays: 30,
    }),
    false,
  );
});

test('an event dated before the grant is never a clawback', () => {
  assert.equal(
    isWithinClawbackWindow({
      grantedAt: new Date('2026-06-10T00:00:00Z'),
      eventAt: new Date('2026-06-01T00:00:00Z'),
      clawbackWindowDays: 30,
    }),
    false,
  );
});
