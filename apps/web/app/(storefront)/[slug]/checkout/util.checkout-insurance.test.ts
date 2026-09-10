import assert from "node:assert/strict";
import { test } from "node:test";

import type { TulipQuotePreview } from "./checkout.types";
import { getCheckoutInsuranceState } from "./util.checkout-insurance";

const preview: TulipQuotePreview = {
  mode: "required",
  connected: true,
  inclusionEnabled: true,
  quoteUnavailable: false,
  quoteError: null,
  requestedOptIn: true,
  appliedOptIn: true,
  amount: 0,
  insuredProductCount: 1,
  uninsuredProductCount: 1,
  insuredProductIds: ["bike"],
  error: null,
};

const quote = {
  mode: "required",
  preview,
  isLoading: false,
  isFetched: true,
  checked: false,
} satisfies Parameters<typeof getCheckoutInsuranceState>[0];

test("coverage paid by the store is included without a customer opt-in", () => {
  assert.equal(getCheckoutInsuranceState(quote), "included");
});

test("required coverage with an extra charge is not labelled included", () => {
  assert.equal(
    getCheckoutInsuranceState({
      ...quote,
      preview: { ...preview, inclusionEnabled: false, amount: 7.5 },
    }),
    "selected",
  );
});

test("a public offer hidden by the store cannot reuse a previous covered quote", () => {
  assert.equal(getCheckoutInsuranceState({ ...quote, mode: "no_public" }), "hidden");
});

test("optional eligibility only becomes coverage when the customer selects it", () => {
  const optional = {
    ...quote,
    mode: "optional",
    preview: { ...preview, mode: "optional" },
  } as const;
  assert.equal(getCheckoutInsuranceState(optional), "unselected");
  assert.equal(getCheckoutInsuranceState({ ...optional, checked: true }), "included");
});

test("pending or refreshed quotes do not claim coverage from stale data", () => {
  assert.equal(getCheckoutInsuranceState({ ...quote, isFetched: false }), "loading");
  assert.equal(getCheckoutInsuranceState({ ...quote, isLoading: true }), "loading");
});

test("required quote errors take precedence over an inclusion setting", () => {
  for (const failed of [
    { ...preview, quoteUnavailable: true },
    { ...preview, error: "errors.tulipQuoteFailed" },
    { ...preview, appliedOptIn: false },
  ]) {
    assert.equal(getCheckoutInsuranceState({ ...quote, preview: failed }), "unavailable");
  }
});

test("a cart without eligible products cannot advertise included coverage", () => {
  assert.equal(
    getCheckoutInsuranceState({
      ...quote,
      preview: { ...preview, insuredProductIds: [], insuredProductCount: 0 },
    }),
    "unavailable",
  );
});
