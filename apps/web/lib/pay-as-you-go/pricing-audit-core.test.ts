import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BUILT_IN_PAY_AS_YOU_GO_TIERS } from './config';
import { type AuditFeeRow, auditAllowance, auditStoreFees } from './pricing-audit-core';

const LADDER = { tiers: BUILT_IN_PAY_AS_YOU_GO_TIERS };

const fee = (overrides: Partial<AuditFeeRow>): AuditFeeRow => ({
  source: 'manual',
  status: 'billed',
  amountCents: 100,
  monthlyIndex: 1,
  billingMonth: '2026-07',
  ...overrides,
});

test('fees charged on the expected ladder match', () => {
  const audit = auditStoreFees(LADDER, [
    fee({ monthlyIndex: 1, amountCents: 100 }),
    fee({ monthlyIndex: 51, amountCents: 80 }),
    fee({ monthlyIndex: 201, amountCents: 50, status: 'voided' }),
    fee({ source: 'free', monthlyIndex: null, amountCents: 0 }),
    fee({ source: 'marketplace_online', monthlyIndex: null, amountCents: 100 }),
  ]);

  assert.equal(audit.verdict, 'match');
  assert.equal(audit.manualRows, 3);
  assert.equal(audit.manualDeltaCents, 0);
});

test('a store charged a launch flat rate is a mismatch, with the schedule it paid', () => {
  const audit = auditStoreFees(LADDER, [
    fee({ monthlyIndex: 1, amountCents: 25, billingMonth: '2026-06' }),
    fee({ monthlyIndex: 2, amountCents: 25, billingMonth: '2026-06' }),
    fee({ monthlyIndex: 3, amountCents: 25, billingMonth: '2026-06', status: 'voided' }),
    fee({ monthlyIndex: 1, amountCents: 25, billingMonth: '2026-07', source: 'online' }),
  ]);

  assert.equal(audit.verdict, 'mismatch');
  assert.equal(audit.mismatchedManual, 3);
  assert.equal(audit.mismatchedOnline, 1);
  // Two non-voided manual rows at 25 instead of 100.
  assert.equal(audit.manualDeltaCents, -150);
  assert.deepEqual(audit.observedManualPrices, [
    { amountCents: 25, rows: 3, fromIndex: 1, toIndex: 3 },
  ]);
  assert.deepEqual(
    audit.months.map((m) => [m.billingMonth, m.mismatched, m.observedCents]),
    [
      ['2026-06', 3, [25]],
      ['2026-07', 1, [25]],
    ],
  );
});

test('a tariff change over time shows in the months that disagree', () => {
  const audit = auditStoreFees(LADDER, [
    fee({ monthlyIndex: 1, amountCents: 25, billingMonth: '2026-06' }),
    fee({ monthlyIndex: 1, amountCents: 100, billingMonth: '2026-08' }),
  ]);

  assert.deepEqual(
    audit.months.map((m) => [m.billingMonth, m.mismatched]),
    [
      ['2026-06', 1],
      ['2026-08', 0],
    ],
  );
});

test('an online fee is never judged on its index', () => {
  const audit = auditStoreFees(LADDER, [
    // Priced in the 80c band at checkout (marketplace rows counted), recorded at index 1.
    fee({ source: 'online', status: 'collected', monthlyIndex: 1, amountCents: 80 }),
  ]);

  assert.equal(audit.mismatchedOnline, 0);
  assert.equal(audit.verdict, 'no_evidence');
});

test('an online fee above the highest price is the legacy combined application fee', () => {
  const audit = auditStoreFees(LADDER, [
    fee({ source: 'online', status: 'collected', monthlyIndex: 1, amountCents: 200 }),
  ]);

  assert.equal(audit.combinedOnlineRows, 1);
  assert.equal(audit.mismatchedOnline, 0);
});

test('a store without manual fees has no evidence', () => {
  assert.equal(auditStoreFees(LADDER, []).verdict, 'no_evidence');
});

test('allowance notes', () => {
  const base = { freezeFreeReservations: 15, freeReservationsUsed: 0, rowCreatedAfterStore: false };

  assert.match(auditAllowance({ ...base, freeReservationsGranted: null })[0], /no subscription row/);
  assert.equal(
    auditAllowance({ ...base, freeReservationsGranted: null, freeReservationsUsed: 20 }).length,
    2,
  );
  assert.match(
    auditAllowance({ ...base, freeReservationsGranted: 0, rowCreatedAfterStore: true })[0],
    /column default/,
  );
  assert.deepEqual(auditAllowance({ ...base, freeReservationsGranted: 0 }), []);
  assert.match(
    auditAllowance({ ...base, freeReservationsGranted: 2, freeReservationsUsed: 5 })[0],
    /cut after use/,
  );
});
