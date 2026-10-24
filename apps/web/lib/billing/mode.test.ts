import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  describeBillingMisconfiguration,
  getBillingMode,
  isBillingEnabled,
  louezBillingSchema,
  resolveBillingMode,
} from './mode';

const initial = process.env.LOUEZ_BILLING;
afterEach(() => {
  if (initial === undefined) delete process.env.LOUEZ_BILLING;
  else process.env.LOUEZ_BILLING = initial;
});

test('billing is off unless LOUEZ_BILLING is exactly cloud', () => {
  assert.equal(resolveBillingMode(undefined), 'off');
  assert.equal(resolveBillingMode(''), 'off');
  assert.equal(resolveBillingMode('off'), 'off');
  assert.equal(resolveBillingMode('cloud'), 'cloud');
  // Only reachable when SKIP_ENV_VALIDATION hands the raw value through.
  assert.equal(resolveBillingMode('Cloud'), 'off');
  assert.equal(resolveBillingMode('true'), 'off');
  assert.equal(resolveBillingMode('on'), 'off');
});

test('the mode is read from the environment at call time', () => {
  delete process.env.LOUEZ_BILLING;
  assert.equal(getBillingMode(), 'off');
  assert.equal(isBillingEnabled(), false);

  process.env.LOUEZ_BILLING = 'cloud';
  assert.equal(getBillingMode(), 'cloud');
  assert.equal(isBillingEnabled(), true);

  process.env.LOUEZ_BILLING = 'off';
  assert.equal(isBillingEnabled(), false);

  process.env.LOUEZ_BILLING = '';
  assert.equal(getBillingMode(), 'off');
});

test('the env schema accepts off, cloud or nothing, and rejects anything else', () => {
  assert.equal(louezBillingSchema.safeParse(undefined).success, true);
  assert.equal(louezBillingSchema.safeParse('off').success, true);
  assert.equal(louezBillingSchema.safeParse('cloud').success, true);
  for (const invalid of ['on', 'true', 'CLOUD', 'yes', 1]) {
    assert.equal(louezBillingSchema.safeParse(invalid).success, false, String(invalid));
  }
});

test('a cloud-looking instance without LOUEZ_BILLING gets a start-up error', () => {
  const cloudLike = { platformMode: true, stripePriceProMonthly: 'price_123' };

  assert.match(
    describeBillingMisconfiguration({ ...cloudLike, louezBilling: undefined }) ?? '',
    /Billing is off on what looks like Louez Cloud/,
  );
  // An explicit choice, either way, silences it.
  assert.equal(describeBillingMisconfiguration({ ...cloudLike, louezBilling: 'off' }), null);
  assert.equal(describeBillingMisconfiguration({ ...cloudLike, louezBilling: 'cloud' }), null);
  // A value the schema should have rejected is reported, whatever the deployment.
  assert.match(
    describeBillingMisconfiguration({ ...cloudLike, louezBilling: 'Cloud' }) ?? '',
    /neither "off" nor "cloud"/,
  );
  assert.match(
    describeBillingMisconfiguration({
      platformMode: false,
      stripePriceProMonthly: undefined,
      louezBilling: 'on',
    }) ?? '',
    /neither "off" nor "cloud"/,
  );
  // A self-host, single-store or without plan prices, is not the cloud.
  assert.equal(
    describeBillingMisconfiguration({ ...cloudLike, platformMode: false, louezBilling: undefined }),
    null,
  );
  assert.equal(
    describeBillingMisconfiguration({
      platformMode: true,
      stripePriceProMonthly: undefined,
      louezBilling: undefined,
    }),
    null,
  );
});
