import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCompanyUpdate } from "./util.company-settings";

const values = {
  country: "HR",
  currency: "HRK",
  billingAddressSameAsStore: false,
  billingAddress: "Ilica 1",
  billingCity: "Zagreb",
  billingPostalCode: "10000",
  billingCountry: "HR",
};

test("an unchanged currency is not sent, so a legacy one is kept", () => {
  const update = buildCompanyUpdate(values, "HRK");
  assert.equal("currency" in update, false);
  assert.deepEqual(update.billingAddress, {
    sameAsStore: false,
    address: "Ilica 1",
    city: "Zagreb",
    postalCode: "10000",
    country: "HR",
  });
});

test("a new currency is sent", () => {
  assert.equal(buildCompanyUpdate({ ...values, currency: "EUR" }, "HRK").currency, "EUR");
  assert.equal(buildCompanyUpdate({ ...values, currency: "EUR" }, null).currency, "EUR");
});

test("the store's own address needs no billing fields", () => {
  assert.deepEqual(
    buildCompanyUpdate({ ...values, billingAddressSameAsStore: true }, "HRK").billingAddress,
    {
      sameAsStore: true,
    },
  );
});
