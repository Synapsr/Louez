import assert from "node:assert/strict";
import { test } from "node:test";

import { demo } from "@/components/landing-demos/features/storefront-home.demo";
import {
  getRentalDraftForDay,
  buildDateTimeRange,
  splitStoreDateTime,
} from "@/components/storefront/date-picker/core/use-rental-date-core";
import { locales } from "@/i18n/config";
import { createDemoPeriod, DEMO_RULES, getDemoProducts } from "@/lib/landing-demos/fixtures";
import {
  getStorefrontHomeDemo,
  STOREFRONT_HOME_HOURS,
  STOREFRONT_HOME_THEME,
} from "@/lib/landing-demos/storefront-home";
import { getStorefrontHomeDemoText } from "@/lib/landing-demos/text.storefront-home";
import { buildStoreThemeStyle, DEFAULT_STORE_THEME } from "@/lib/theme/util.store-theme";
import { validateRentalPeriodSelection } from "@/lib/utils/util.rental-period";
import { getStoreStatus } from "@/lib/utils/util.store-status";

test("home fixtures keep the shared rental inventory, prices and French shop identity in every locale", () => {
  for (const locale of locales) {
    const shop = getStorefrontHomeDemo(locale);
    assert.equal(shop.name, "Maison du Vélo");
    assert.equal(shop.address, "12 rue des Cyclistes\n44000 Nantes");
    assert.equal(shop.products.length, 8);
    assert.deepEqual(shop.products, getDemoProducts(locale).slice(0, 8));
    assert.ok(shop.tagline.length > 20);
    assert.ok(shop.announcement.text.length > 20);
    assert.equal(shop.announcement.href, null);
    assert.equal(shop.logoUrl, null);
    assert.equal(shop.heroImages.length, 2);
    assert.ok(shop.heroImages.every((src) => src.startsWith("https://louez.s3.fr-par.scw.cloud/")));
  }
  assert.equal(new Set(locales.map((locale) => getStorefrontHomeDemo(locale).tagline)).size, 8);
  assert.deepEqual(getStorefrontHomeDemoText("unknown"), getStorefrontHomeDemoText("fr"));
});

test("the brand overrides primary, foreground and focus ring using the production theme builder", () => {
  const style = buildStoreThemeStyle(STOREFRONT_HOME_THEME);
  assert.notEqual(style, buildStoreThemeStyle(DEFAULT_STORE_THEME));
  for (const variable of ["--primary:", "--primary-foreground:", "--ring:"]) {
    assert.ok(style.includes(variable));
  }
  assert.equal(STOREFRONT_HOME_THEME.mode, "light");
});

test("opening hours yield a real status for each day of the rolling demo week", () => {
  const period = createDemoPeriod();
  for (let offset = 0; offset < 7; offset++) {
    const now = new Date(period.start);
    now.setDate(now.getDate() + offset);
    assert.ok(getStoreStatus(STOREFRONT_HOME_HOURS, DEMO_RULES.timezone, now));
  }
});

test("the scripted end-date choice extends the real picker range and preserves pickup time", () => {
  const period = createDemoPeriod();
  const start = splitStoreDateTime(period.start, DEMO_RULES.timezone);
  const end = splitStoreDateTime(period.end, DEMO_RULES.timezone);
  assert.ok(start && end);
  const selectedDay = new Date(start.day);
  selectedDay.setDate(selectedDay.getDate() + 1);
  const draft = getRentalDraftForDay(
    {
      startDate: start.day,
      endDate: end.day,
      startTime: start.time,
      endTime: end.time,
      activeField: "end",
      endIsAuto: false,
    },
    selectedDay,
    { ...DEMO_RULES, intervalMinutes: 30 },
  );
  assert.equal(draft.startDate?.getTime(), start.day.getTime());
  assert.equal(draft.endDate?.getTime(), selectedDay.getTime());
  assert.equal(draft.startTime, start.time);
  assert.ok(draft.startDate && draft.endDate);
  const selected = buildDateTimeRange({
    startDate: draft.startDate,
    endDate: draft.endDate,
    startTime: draft.startTime,
    endTime: draft.endTime,
    timezone: DEMO_RULES.timezone,
  });
  assert.ok(selected.end > period.end);
  assert.equal(validateRentalPeriodSelection({ ...selected, rules: DEMO_RULES }).ok, true);
});

test("home playback scrolls then chooses dates with paced, locale-independent cues", () => {
  assert.equal(demo.actor, "customer");
  assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
  assert.equal(demo.cues.filter((cue) => cue.scroll).length, 2);
  assert.equal(demo.cues.filter((cue) => cue.click).length, 3);
  for (const [index, cue] of demo.cues.entries()) {
    assert.ok(cue.at < demo.duration);
    assert.match(cue.selector, /^\[data-/);
    assert.doesNotMatch(cue.selector, /aria-|:has-text|:text/);
    const previous = demo.cues[index - 1];
    if (previous) assert.ok(cue.at > previous.at);
    if (cue.click || cue.scroll) {
      assert.ok(previous);
      assert.equal(cue.selector, previous.selector);
      assert.ok(cue.at - previous.at >= 700 && cue.at - previous.at <= 900);
    }
  }
});
