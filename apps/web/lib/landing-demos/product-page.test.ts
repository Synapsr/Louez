import assert from "node:assert/strict";
import test from "node:test";
import { addDays } from "date-fns";
import { buildStoreDate } from "@/lib/utils/business-hours";
import { getStorefrontProductPrice } from "@/lib/utils/util.storefront-product-pricing";
import { getStorefrontRateRows } from "@/lib/utils/util.storefront-pricing";
import { locales } from "@/i18n/config";
import { createDemoPeriod, getDemoProducts } from "./fixtures";
import {
  getDemoProductCalendar,
  getDemoProductCatalog,
  getDemoProductCart,
  getDemoProductPage,
} from "./product-page";
import { getDemoProductPageText } from "./text.product-page";

test("the detail extends the translated catalog without changing its source", () => {
  for (const locale of locales) {
    const source = getDemoProducts(locale);
    const { product, accessories, booking } = getDemoProductPage(locale, "demo-city-bike", true);
    assert.equal(product.name, source[0]?.name);
    assert.equal(product.price, source[0]?.price);
    assert.equal(product.images.length, 2);
    assert.ok(product.description?.includes(getDemoProductPageText(locale).description));
    assert.equal(accessories.length, 3);
    assert.equal(accessories[0]?.name, getDemoProductPageText(locale).helmet);
    assert.equal(booking.timezone, "Europe/Paris");
    assert.equal(source[0]?.images?.length, 1);
    assert.equal(source[0]?.pricingTiers, undefined);
  }
});

test("longer periods use the app's tier calculation and the cart agrees", () => {
  const initial = createDemoPeriod();
  const { product } = getDemoProductPage();
  const day = getDemoProductCalendar(initial).reference;
  const period = {
    start: buildStoreDate(day, "09:00", "Europe/Paris"),
    end: buildStoreDate(addDays(day, 6), "18:00", "Europe/Paris"),
  };
  const short = getStorefrontProductPrice({
    product,
    startDate: initial.start,
    endDate: initial.end,
  });
  const long = getStorefrontProductPrice({
    product,
    startDate: period.start,
    endDate: period.end,
    timezone: "Europe/Paris",
  });
  assert.equal(short.subtotal, 20);
  assert.equal(long.discountPercent, 25);
  assert.equal(long.subtotal, 105);
  assert.equal(long.originalSubtotal, 140);
  const catalogProduct = getDemoProductCatalog().find((entry) => entry.id === product.id);
  assert.ok(catalogProduct);
  assert.equal(
    getStorefrontProductPrice({
      product: catalogProduct,
      startDate: period.start,
      endDate: period.end,
    }).subtotal,
    long.subtotal,
  );
  assert.equal(getDemoProductCart({ [product.id]: 2 }, period).summary.total, long.subtotal * 2);
  assert.equal(getDemoProductCart({ [product.id]: 2 }, period).summary.deposit, 300);
  const rows = getStorefrontRateRows(product);
  assert.deepEqual(
    rows.map((row) => row.price),
    [20, 51, 105],
  );
  assert.ok(rows[2] && rows[0] && rows[2].price / 7 < rows[0].price);
});

test("extras are separate priced cart lines with independent deposits and stock limits", () => {
  const period = createDemoPeriod();
  const cart = getDemoProductCart(
    { "demo-city-bike": 1, "demo-helmet": 1, "demo-child-seat": 1, "demo-panniers": 1 },
    period,
  );
  assert.equal(cart.items.length, 4);
  assert.equal(cart.summary.total, 36);
  assert.equal(cart.summary.deposit, 270);
  const clamped = getDemoProductCart(
    {
      "demo-helmet": 999,
      "demo-city-bike": 99,
      "demo-child-seat": NaN,
      "demo-panniers": -1,
      unknown: 1,
    },
    period,
  );
  assert.equal(clamped.items.find((item) => item.productId === "demo-helmet")?.quantity, 12);
  assert.equal(clamped.items.find((item) => item.productId === "demo-city-bike")?.quantity, 8);
  assert.equal(clamped.items.length, 2);
  assert.equal(getDemoProductCart({}, period).summary.count, 0);
});

test("booked days and crossing ranges are blocked across month ends and Paris DST", () => {
  for (const date of [
    "2026-01-30T08:00:00Z",
    "2026-03-28T08:00:00Z",
    "2026-10-24T07:00:00Z",
    "2026-12-31T08:00:00Z",
  ]) {
    const period = { start: new Date(date), end: new Date(date) };
    const calendar = getDemoProductCalendar(period);
    const range = (startOffset: number, endOffset: number) => ({
      start: buildStoreDate(addDays(calendar.reference, startOffset), "09:00", "Europe/Paris"),
      end: buildStoreDate(addDays(calendar.reference, endOffset), "18:00", "Europe/Paris"),
    });
    assert.equal(calendar.unavailableDates.length, 2);
    assert.equal(calendar.isDayUnavailable(addDays(calendar.reference, 1)), true);
    assert.equal(calendar.isDayUnavailable(addDays(calendar.reference, 2)), true);
    assert.equal(calendar.isDayUnavailable(addDays(calendar.reference, 3)), false);
    assert.equal(calendar.isPeriodAvailable(range(0, 3)), false);
    assert.equal(calendar.isPeriodAvailable(range(3, 5)), true);
  }
});
