import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { BUILT_IN_PAY_AS_YOU_GO_TIERS, priceForLocationIndex } from './config';
import {
  LEGACY_FREE_RESERVATIONS,
  PAYG_LADDER_V1,
  buildAdminBillingPatch,
  buildExistingStorePricing,
  buildFrozenPayAsYouGoConfig,
  buildNewStorePricing,
  resolveEnvFreeReservations,
  resolveEnvPayAsYouGoOffer,
  resolveStorePricing,
  samePayAsYouGoPricing,
} from './pricing-lock-core';

const LAUNCH_OFFER = '{"flatRateCents":25}';
const NEW_LADDER = {
  tiers: [
    { upToCount: 10, priceCents: 300 },
    { upToCount: null, priceCents: 200 },
  ],
};

test('a row without config resolves to the frozen legacy ladder, never to an env offer', () => {
  const pricing = resolveStorePricing(
    { billingMode: 'pay_as_you_go', payAsYouGoConfig: null, freeReservationsGranted: 4 },
    'EUR',
  );

  assert.equal(pricing.frozen, false);
  assert.equal(pricing.config.flatRateCents, null);
  assert.deepEqual(pricing.config.tiers, BUILT_IN_PAY_AS_YOU_GO_TIERS);
  assert.equal(pricing.config.currency, 'eur');
  assert.equal(pricing.freeReservationsGranted, 4);
});

test('each store pays the offer frozen on its own row, whatever the offer for new stores', () => {
  const rowFrom = (rawPricing: unknown) => {
    const values = buildNewStorePricing({ rawPricing, rawFreeReservations: '15', currency: 'eur' });
    return {
      billingMode: 'pay_as_you_go' as const,
      payAsYouGoConfig: values.payAsYouGoConfig,
      freeReservationsGranted: values.freeReservationsGranted,
    };
  };
  // A store created under the launch offer, then one created after the offer changed.
  const launchStore = resolveStorePricing(rowFrom(LAUNCH_OFFER), 'eur');
  const laterStore = resolveStorePricing(rowFrom(NEW_LADDER), 'eur');

  assert.equal(priceForLocationIndex(launchStore.config, 1), 25);
  assert.equal(priceForLocationIndex(launchStore.config, 500), 25);
  assert.equal(priceForLocationIndex(laterStore.config, 1), 300);
  assert.equal(priceForLocationIndex(laterStore.config, 11), 200);
});

test('a store with no subscription row is pay-as-you-go on the legacy terms', () => {
  const pricing = resolveStorePricing(undefined, 'usd');

  assert.equal(pricing.billingMode, 'pay_as_you_go');
  assert.equal(pricing.frozen, false);
  assert.deepEqual(pricing.config.tiers, BUILT_IN_PAY_AS_YOU_GO_TIERS);
  assert.equal(pricing.config.currency, 'usd');
  assert.equal(pricing.freeReservationsGranted, LEGACY_FREE_RESERVATIONS);
});

test('creating a row for an existing store without one changes nothing it pays', () => {
  const before = resolveStorePricing(undefined, 'eur');
  const values = buildExistingStorePricing('eur');
  const after = resolveStorePricing(
    {
      billingMode: 'pay_as_you_go',
      payAsYouGoConfig: values.payAsYouGoConfig,
      freeReservationsGranted: values.freeReservationsGranted,
    },
    'eur',
  );

  assert.equal(values.pricingVersion, PAYG_LADDER_V1);
  assert.equal(after.frozen, true);
  assert.deepEqual({ ...after, frozen: false }, before);
});

test('the stored currency never overrides the store currency', () => {
  const pricing = resolveStorePricing(
    {
      billingMode: 'pay_as_you_go',
      payAsYouGoConfig: { flatRateCents: 25, currency: 'usd' },
      freeReservationsGranted: 0,
    },
    'EUR',
  );

  assert.equal(pricing.config.currency, 'eur');
  assert.equal(pricing.frozen, true);
});

test('a frozen config writes every tier out and keeps a flat rate', () => {
  assert.deepEqual(buildFrozenPayAsYouGoConfig({ flatRateCents: 25 }, 'EUR'), {
    flatRateCents: 25,
    tiers: BUILT_IN_PAY_AS_YOU_GO_TIERS,
    currency: 'eur',
  });
  assert.deepEqual(
    buildFrozenPayAsYouGoConfig({ tiers: [{ upToCount: 50, priceCents: 90 }] }, 'usd'),
    {
      flatRateCents: null,
      tiers: [
        { upToCount: 50, priceCents: 90 },
        { upToCount: null, priceCents: 90 },
      ],
      currency: 'usd',
    },
  );
});

test('the env offer accepts a parsed object or raw JSON, and ignores malformed input', () => {
  assert.deepEqual(resolveEnvPayAsYouGoOffer(LAUNCH_OFFER), { flatRateCents: 25 });
  assert.deepEqual(resolveEnvPayAsYouGoOffer({ flatRateCents: 25 }), { flatRateCents: 25 });
  assert.deepEqual(resolveEnvPayAsYouGoOffer('').tiers, BUILT_IN_PAY_AS_YOU_GO_TIERS);
  assert.deepEqual(resolveEnvPayAsYouGoOffer('{not json').tiers, BUILT_IN_PAY_AS_YOU_GO_TIERS);
  assert.deepEqual(resolveEnvPayAsYouGoOffer(undefined).tiers, BUILT_IN_PAY_AS_YOU_GO_TIERS);
});

test('the env free-reservation count is coerced like the env schema', () => {
  assert.equal(resolveEnvFreeReservations(30), 30);
  assert.equal(resolveEnvFreeReservations('30'), 30);
  assert.equal(resolveEnvFreeReservations('0'), 0);
  assert.equal(resolveEnvFreeReservations(undefined), LEGACY_FREE_RESERVATIONS);
  assert.equal(resolveEnvFreeReservations(''), LEGACY_FREE_RESERVATIONS);
  assert.equal(resolveEnvFreeReservations('abc'), LEGACY_FREE_RESERVATIONS);
  assert.equal(resolveEnvFreeReservations(-1), LEGACY_FREE_RESERVATIONS);
});

test('pricing equality ignores currency and tier order, and tells a flat rate apart', () => {
  const ladder = { tiers: BUILT_IN_PAY_AS_YOU_GO_TIERS };
  const shuffled = { tiers: [...BUILT_IN_PAY_AS_YOU_GO_TIERS].reverse(), currency: 'usd' };

  assert.equal(samePayAsYouGoPricing(ladder, shuffled), true);
  assert.equal(samePayAsYouGoPricing(null, ladder), true);
  assert.equal(samePayAsYouGoPricing(ladder, { flatRateCents: 100 }), false);
  assert.equal(samePayAsYouGoPricing({ flatRateCents: 25 }, { flatRateCents: 25, tiers: [] }), true);
  assert.equal(samePayAsYouGoPricing(ladder, NEW_LADDER), false);
});

describe('admin save', () => {
  const ladder = { flatRateCents: null, tiers: BUILT_IN_PAY_AS_YOU_GO_TIERS, currency: 'eur' };
  const loaded = {
    billingMode: 'pay_as_you_go' as const,
    payAsYouGoConfig: ladder,
    freeReservationsGranted: 15,
  };
  const stored = { payAsYouGoConfig: ladder };

  test('saving without touching the billing fields writes none of them', () => {
    // e.g. only the trial days changed, while a referral reward raised the stored allowance.
    assert.deepEqual(buildAdminBillingPatch({ submitted: loaded, loaded, stored }), {});
  });

  test('edited pricing is written spelled out and tagged payg-custom', () => {
    const patch = buildAdminBillingPatch({
      submitted: { ...loaded, payAsYouGoConfig: { flatRateCents: 25, tiers: [], currency: 'eur' } },
      loaded,
      stored,
    });

    assert.equal(patch.pricingVersion, 'payg-custom');
    assert.equal(patch.payAsYouGoConfig?.flatRateCents, 25);
    assert.deepEqual(patch.payAsYouGoConfig?.tiers, BUILT_IN_PAY_AS_YOU_GO_TIERS);
    assert.equal(patch.freeReservationsGranted, undefined);
    assert.equal(patch.billingMode, undefined);
  });

  test('an allowance edit writes only the allowance', () => {
    assert.deepEqual(
      buildAdminBillingPatch({ submitted: { ...loaded, freeReservationsGranted: 40 }, loaded, stored }),
      { freeReservationsGranted: 40 },
    );
  });

  test('a mode edit writes the mode, but a store without a row stays pay-as-you-go', () => {
    const submitted = { ...loaded, billingMode: 'subscription' as const };

    assert.deepEqual(buildAdminBillingPatch({ submitted, loaded, stored }), {
      billingMode: 'subscription',
    });
    assert.deepEqual(buildAdminBillingPatch({ submitted, loaded, stored: null }), {
      billingMode: 'pay_as_you_go',
    });
  });

  test('a row without config gets the pricing the admin saw written down', () => {
    const patch = buildAdminBillingPatch({
      submitted: loaded,
      loaded,
      stored: { payAsYouGoConfig: null },
    });

    assert.equal(patch.pricingVersion, PAYG_LADDER_V1);
    assert.deepEqual(patch.payAsYouGoConfig?.tiers, BUILT_IN_PAY_AS_YOU_GO_TIERS);
  });
});
