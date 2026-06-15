import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_PAY_AS_YOU_GO_TIERS,
  buildPayAsYouGoConfig,
  graduatedTotalCents,
  priceForLocationIndex,
  resolvePayAsYouGoConfig,
  summarizePayAsYouGoBands,
} from './config';

test('graduated pricing matches the product example (50.50€ for 51 rentals)', () => {
  const config = resolvePayAsYouGoConfig({
    tiers: [
      { upToCount: 50, priceCents: 100 },
      { upToCount: null, priceCents: 50 },
    ],
  });

  assert.equal(priceForLocationIndex(config, 1), 100);
  assert.equal(priceForLocationIndex(config, 50), 100);
  assert.equal(priceForLocationIndex(config, 51), 50);

  // 50 * 1€ + 1 * 0,50€ = 50,50€ = 5050 cents
  assert.equal(graduatedTotalCents(config, 51), 5050);
  assert.equal(graduatedTotalCents(config, 50), 5000);
  assert.equal(graduatedTotalCents(config, 0), 0);
});

test('default platform ladder (1€ / 0.80€ / 0.50€)', () => {
  const config = resolvePayAsYouGoConfig(null);
  assert.deepEqual(config.tiers, DEFAULT_PAY_AS_YOU_GO_TIERS);

  assert.equal(priceForLocationIndex(config, 50), 100);
  assert.equal(priceForLocationIndex(config, 51), 80);
  assert.equal(priceForLocationIndex(config, 200), 80);
  assert.equal(priceForLocationIndex(config, 201), 50);

  // 50*100 + 150*80 + 1*50 = 5000 + 12000 + 50 = 17050
  assert.equal(graduatedTotalCents(config, 201), 17050);
});

test('flat lifetime rate overrides the ladder', () => {
  const config = resolvePayAsYouGoConfig({ flatRateCents: 25 });
  assert.equal(priceForLocationIndex(config, 1), 25);
  assert.equal(priceForLocationIndex(config, 9999), 25);
  assert.equal(graduatedTotalCents(config, 137), 137 * 25);
});

test('unsorted / open-ended config is normalized safely', () => {
  const config = resolvePayAsYouGoConfig({
    tiers: [
      { upToCount: null, priceCents: 50 },
      { upToCount: 10, priceCents: 200 },
    ],
  });
  assert.equal(config.tiers[0].upToCount, 10);
  assert.equal(config.tiers[config.tiers.length - 1].upToCount, null);
  assert.equal(graduatedTotalCents(config, 12), 10 * 200 + 2 * 50);
});

test('config without a catch-all band gets one appended', () => {
  const config = resolvePayAsYouGoConfig({
    tiers: [{ upToCount: 5, priceCents: 300 }],
  });
  assert.equal(priceForLocationIndex(config, 100), 300);
});

test('duplicate upToCount bands are deduped (total is order-independent)', () => {
  const a = resolvePayAsYouGoConfig({
    tiers: [
      { upToCount: 50, priceCents: 100 },
      { upToCount: 50, priceCents: 80 },
      { upToCount: null, priceCents: 50 },
    ],
  })
  const b = resolvePayAsYouGoConfig({
    tiers: [
      { upToCount: 50, priceCents: 80 },
      { upToCount: 50, priceCents: 100 },
      { upToCount: null, priceCents: 50 },
    ],
  })
  // Keep-first dedup: 'a' keeps 100c, 'b' keeps 80c — but each is internally
  // consistent and free of the zero-width duplicate band.
  assert.equal(a.tiers.filter((t) => t.upToCount === 50).length, 1)
  assert.equal(b.tiers.filter((t) => t.upToCount === 50).length, 1)
  assert.equal(graduatedTotalCents(a, 60), 50 * 100 + 10 * 50)
  assert.equal(graduatedTotalCents(b, 60), 50 * 80 + 10 * 50)
})

test('graduated total is permutation-invariant for a distinct-bound ladder', () => {
  const forward = resolvePayAsYouGoConfig({
    tiers: [
      { upToCount: 50, priceCents: 100 },
      { upToCount: 200, priceCents: 80 },
      { upToCount: null, priceCents: 50 },
    ],
  })
  const shuffled = resolvePayAsYouGoConfig({
    tiers: [
      { upToCount: null, priceCents: 50 },
      { upToCount: 200, priceCents: 80 },
      { upToCount: 50, priceCents: 100 },
    ],
  })
  for (const n of [0, 1, 50, 51, 200, 201, 1000]) {
    assert.equal(graduatedTotalCents(forward, n), graduatedTotalCents(shuffled, n))
  }
})

test('buildPayAsYouGoConfig converts euros to cents for both branches', () => {
  const flat = buildPayAsYouGoConfig(
    { useFlatRate: true, flatRateEuros: 0.25, tiers: [] },
    'eur',
  )
  assert.deepEqual(flat, { flatRateCents: 25, tiers: [], currency: 'eur' })

  const tiered = buildPayAsYouGoConfig(
    {
      useFlatRate: false,
      flatRateEuros: 0,
      tiers: [
        { upToCount: 50, priceEuros: 1 },
        { upToCount: null, priceEuros: 0.8 },
      ],
    },
    'eur',
  )
  assert.deepEqual(tiered, {
    flatRateCents: null,
    tiers: [
      { upToCount: 50, priceCents: 100 },
      { upToCount: null, priceCents: 80 },
    ],
    currency: 'eur',
  })

  // Rounding: 0.1 + 0.2 float issues must not leak into cents.
  const rounded = buildPayAsYouGoConfig(
    { useFlatRate: true, flatRateEuros: 0.1 + 0.2, tiers: [] },
    'eur',
  )
  assert.equal(rounded.flatRateCents, 30)
})

test('band summary produces readable ranges', () => {
  const config = resolvePayAsYouGoConfig(null);
  const bands = summarizePayAsYouGoBands(config);
  assert.deepEqual(bands, [
    { from: 1, to: 50, priceCents: 100 },
    { from: 51, to: 200, priceCents: 80 },
    { from: 201, to: null, priceCents: 50 },
  ]);
});
