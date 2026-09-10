import assert from "node:assert/strict";
import { test } from "node:test";

import { isSamePendingCheckout, type PendingCheckoutSnapshot } from "./util.pending-checkout";

const start = new Date("2026-09-11T07:00:00.000Z");
const end = new Date("2026-09-11T16:00:00.000Z");

/** The row as the checkout writes it: numbers formatted, optionals absent. */
const written = (): PendingCheckoutSnapshot => ({
  reservation: {
    customerId: "cust_1",
    startDate: start,
    endDate: end,
    subtotalAmount: "25.00",
    depositAmount: "100.00",
    totalAmount: "25.00",
    subtotalExclTax: null,
    taxAmount: null,
    taxRate: null,
    customerNotes: null,
    source: "online",
    billingSnapshot: { customerType: "individual", companyName: null },
    outboundMethod: "address",
    returnMethod: "store",
    deliveryOption: "delivery",
    deliveryAddress: "1 rue de la Location",
    deliveryCity: "Paris",
    deliveryPostalCode: "75001",
    deliveryCountry: "FR",
    deliveryLatitude: "48.8566",
    deliveryLongitude: "2.3522",
    deliveryDistanceKm: "4.20",
    deliveryFee: "0.00",
    tulipInsuranceOptIn: false,
    tulipInsuranceAmount: null,
    promoCodeId: null,
    discountAmount: "0.00",
    promoCodeSnapshot: null,
    returnAddress: null,
    returnCity: null,
    returnPostalCode: null,
    returnCountry: null,
    returnLatitude: null,
    returnLongitude: null,
    returnDistanceKm: null,
    pickupLocationId: null,
    returnLocationId: "loc_1",
    pickupLocationSnapshot: null,
    returnLocationSnapshot: { name: "Boutique", address: "2 quai" },
  },
  items: [
    {
      productId: "prod_bike",
      isCustomItem: false,
      quantity: 1,
      unitPrice: "25.00",
      depositPerUnit: "100.00",
      totalPrice: "25.00",
      combinationKey: null,
      selectedAttributes: null,
      taxRate: null,
      taxAmount: null,
      priceExclTax: null,
      totalExclTax: null,
    },
    {
      productId: "prod_helmet",
      isCustomItem: false,
      quantity: 2,
      unitPrice: "3.00",
      depositPerUnit: "0.00",
      totalPrice: "6.00",
      combinationKey: "size:M",
      selectedAttributes: { size: "M" },
      taxRate: null,
      taxAmount: null,
      priceExclTax: null,
      totalExclTax: null,
    },
  ],
});

/** The same booking as the database hands it back: padded decimals, reordered lines. */
const stored = (): PendingCheckoutSnapshot => {
  const snapshot = written();
  return {
    reservation: {
      ...snapshot.reservation,
      startDate: new Date(start.getTime()),
      deliveryLatitude: "48.8566000",
      deliveryLongitude: "2.3522000",
      deliveryFee: "0",
      returnLocationSnapshot: { address: "2 quai", name: "Boutique" },
    },
    items: [...snapshot.items].reverse(),
  };
};

test("an unchanged cart matches the pending reservation despite formatting differences", () => {
  assert.equal(isSamePendingCheckout(stored(), written()), true);
});

test("a changed quantity is a different booking", () => {
  const candidate = written();
  candidate.items[0].quantity = 2;
  candidate.items[0].totalPrice = "50.00";
  assert.equal(isSamePendingCheckout(stored(), candidate), false);
});

test("an added line is a different booking", () => {
  const candidate = written();
  candidate.items.push({ ...candidate.items[0], productId: "prod_lock" });
  assert.equal(isSamePendingCheckout(stored(), candidate), false);
});

test("different dates are a different booking", () => {
  const candidate = written();
  candidate.reservation.endDate = new Date("2026-09-12T16:00:00.000Z");
  assert.equal(isSamePendingCheckout(stored(), candidate), false);
});

test("a changed delivery leg is a different booking", () => {
  const candidate = written();
  candidate.reservation.outboundMethod = "store";
  candidate.reservation.deliveryAddress = null;
  assert.equal(isSamePendingCheckout(stored(), candidate), false);
});

test("another customer is a different booking", () => {
  const candidate = written();
  candidate.reservation.customerId = "cust_2";
  assert.equal(isSamePendingCheckout(stored(), candidate), false);
});

test("changed billing details are a different booking", () => {
  const candidate = written();
  candidate.reservation.billingSnapshot = { customerType: "business", companyName: "LUMY" };
  assert.equal(isSamePendingCheckout(stored(), candidate), false);
});

test("absent optionals equal null columns", () => {
  const candidate = written();
  delete candidate.reservation.customerNotes;
  delete candidate.reservation.promoCodeSnapshot;
  assert.equal(isSamePendingCheckout(stored(), candidate), true);
});
