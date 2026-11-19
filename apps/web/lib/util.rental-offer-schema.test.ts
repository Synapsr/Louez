import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRentalOffers, periodQuantity } from "./util.rental-offer-schema";

const base = {
  url: "https://velos.louez.io/product/velo-electrique",
  currency: "EUR",
  inStock: true,
  seller: { name: "Vélos du Port", url: "https://velos.louez.io" },
  priceValidUntil: "2027-11-18",
};

test("one rate is one Offer: a rental, with the period its price covers", () => {
  const offer = buildRentalOffers({ ...base, rates: [{ price: 25, periodMinutes: 1440 }] });
  assert.ok(!Array.isArray(offer));
  assert.equal(offer["@type"], "Offer");
  assert.equal(offer.price, 25);
  assert.equal(offer.priceCurrency, "EUR");
  assert.equal(offer.businessFunction, "http://purl.org/goodrelations/v1#LeaseOut");
  assert.equal(offer.availability, "https://schema.org/InStock");
  assert.deepEqual(offer.priceSpecification, {
    "@type": "UnitPriceSpecification",
    price: 25,
    priceCurrency: "EUR",
    unitCode: "DAY",
    referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "DAY" },
  });
  // Valid JSON-LD needs no undefined value anywhere.
  assert.deepEqual(JSON.parse(JSON.stringify(offer)), offer);
});

test("a rate grid is one Offer per rate, each with its own period", () => {
  const offers = buildRentalOffers({
    ...base,
    inStock: false,
    rates: [
      { price: 8, periodMinutes: 120 },
      { price: 25, periodMinutes: 1440 },
      { price: 120, periodMinutes: 10080 },
    ],
  });
  assert.ok(Array.isArray(offers));
  assert.deepEqual(
    offers.map((offer) => [offer.price, (offer.priceSpecification as { unitCode: string }).unitCode]),
    [
      [8, "HUR"],
      [25, "DAY"],
      [120, "WEE"],
    ],
  );
  assert.ok(offers.every((offer) => offer.availability === "https://schema.org/OutOfStock"));
  assert.deepEqual(
    (offers[0].priceSpecification as { referenceQuantity: unknown }).referenceQuantity,
    { "@type": "QuantitativeValue", value: 2, unitCode: "HUR" },
  );
});

test("a price from a percentage tier is rounded to the cent", () => {
  const offer = buildRentalOffers({ ...base, rates: [{ price: 120.00000075, periodMinutes: 10080 }] });
  assert.ok(!Array.isArray(offer));
  assert.equal(offer.price, 120);
  assert.equal((offer.priceSpecification as { price: number }).price, 120);
});

test("a forfait claims no period", () => {
  const offer = buildRentalOffers({ ...base, rates: [{ price: 90, periodMinutes: null }] });
  assert.ok(!Array.isArray(offer));
  assert.equal(offer.priceSpecification, undefined);
  assert.equal(periodQuantity(0), null);
  assert.deepEqual(periodQuantity(45), { value: 45, unitCode: "MIN" });
});
