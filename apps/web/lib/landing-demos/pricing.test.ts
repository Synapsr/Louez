import assert from "node:assert/strict";
import test from "node:test";
import { addDays } from "date-fns";
import { calculateRateBasedPrice, priceDurationToMinutes } from "@louez/utils";
import { productSchema } from "@louez/validations";

import { demo as ladder } from "@/components/landing-demos/features/pricing-ladder.demo";
import { demo as seasons } from "@/components/landing-demos/features/pricing-seasons-promos.demo";
import { locales } from "@/i18n/config";
import { createDemoPeriod, getDemoProducts } from "@/lib/landing-demos/fixtures";
import {
  createDemoPricingSeasons,
  createDemoPricingValues,
  createDemoPromoCodes,
} from "@/lib/landing-demos/pricing";
import { getDemoToday } from "@/lib/landing-demos/reservations";
import { getPricingDemoText } from "@/lib/landing-demos/text.pricing";

test("all locales use the shop's valid daily prices and long-duration discounts", () => {
  for (const locale of locales) {
    const values = createDemoPricingValues(locale);
    assert.equal(productSchema.safeParse(values).success, true);
    assert.equal(values.name, getDemoProducts(locale)[0].name);
    assert.deepEqual(values.basePriceDuration, { price: "20", duration: 1, unit: "day" });
    const rates = (values.rateTiers ?? []).map((tier, index) => ({
      id: tier.id ?? `demo-rate-${index}`,
      displayOrder: index,
      price: Number(tier.price),
      period: priceDurationToMinutes(tier.duration, tier.unit),
    }));
    const config = {
      basePrice: 20,
      basePeriodMinutes: 1440,
      rates,
      deposit: 150,
      enforceStrictTiers: true,
    };
    assert.equal(calculateRateBasedPrice(config, 3 * 1440, 1).subtotal, 54);
    assert.equal(calculateRateBasedPrice(config, 7 * 1440, 1).subtotal, 112);
    assert.ok(54 / 3 > 112 / 7);
  }
});

test("summer follows the current date, rolls after August and applies a 25% premium", () => {
  for (const today of [
    new Date(2030, 0, 1),
    new Date(2030, 7, 31),
    new Date(2030, 8, 1),
    new Date(2030, 11, 31),
  ]) {
    const period = { start: addDays(today, 7), end: addDays(today, 8) };
    const year = today.getFullYear() + (today.getMonth() > 7 ? 1 : 0);
    for (const locale of locales) {
      const [season] = createDemoPricingSeasons(period, locale);
      assert.equal(season.startDate, `${year}-06-01`);
      assert.equal(season.endDate, `${year}-08-31`);
      assert.equal(season.name, getPricingDemoText(locale).summer);
      assert.equal(season.price, "25.00");
      assert.deepEqual(
        season.tiers.map((tier) => [tier.period, tier.price]),
        [
          [4320, "67.50"],
          [10080, "140.00"],
        ],
      );
    }
  }
});

test("promo fixtures remain active, expired and exhausted relative to demo today", () => {
  const period = createDemoPeriod();
  const today = getDemoToday(period);
  const [active, expired, exhausted] = createDemoPromoCodes(period);
  assert.equal(active.isActive, true);
  assert.ok(active.startsAt && active.startsAt < today);
  assert.ok(active.expiresAt && active.expiresAt > today);
  assert.ok(active.maxUsageCount && active.currentUsageCount < active.maxUsageCount);
  assert.ok(expired.expiresAt && expired.expiresAt < today);
  assert.ok(exhausted.expiresAt && exhausted.expiresAt > today);
  assert.equal(exhausted.currentUsageCount, exhausted.maxUsageCount);
  assert.equal(new Set([active.id, expired.id, exhausted.id]).size, 3);
});

test("fixture edits cannot leak into the next loop", () => {
  const values = createDemoPricingValues();
  values.basePriceDuration.price = "999";
  values.rateTiers?.splice(0);
  const fresh = createDemoPricingValues();
  assert.equal(fresh.basePriceDuration.price, "20");
  assert.equal(fresh.rateTiers?.length, 2);
});

test("pricing scripts give every action an earlier pointer move and time to read", () => {
  for (const demo of [ladder, seasons]) {
    assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
    let previousAt = -1;
    for (const [index, cue] of demo.cues.entries()) {
      assert.ok(cue.at > previousAt && cue.at < demo.duration);
      assert.match(cue.selector, /^\[data-[a-z-]+="[a-z0-9-]+"\]$/);
      if (cue.click || cue.press || cue.emit || cue.type) {
        const move = demo.cues[index - 1];
        assert.equal(move.selector, cue.selector);
        assert.ok(!move.click && !move.press && !move.emit && !move.type);
        assert.ok(cue.at - move.at >= 700 && cue.at - move.at <= 900);
      }
      previousAt = cue.at;
    }
    const lastCue = demo.cues.at(-1);
    assert.ok(lastCue);
    assert.ok(demo.duration - lastCue.at - (lastCue.type?.duration ?? 0) >= 1500);
  }
});
