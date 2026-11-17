import assert from "node:assert/strict";
import { test } from "node:test";

import { paygFeeOfPayment } from "./payg-fee-analytics";

// payg_fee_charged counts the commission the payment carries, whoever bills the store.

test("a store the billing service bills: its policy's reservation commission", () => {
  for (const policyScope of ["store", "default"] as const) {
    assert.deepEqual(
      paygFeeOfPayment({
        feeFacts: { reservationMinor: 400, policyScope },
        applicationFeeCents: 400,
        isPayAsYouGoStore: false,
      }),
      { feeCents: 400, policyScope },
    );
  }
});

test("a legacy store: the metadata's commission", () => {
  assert.deepEqual(
    paygFeeOfPayment({
      feeFacts: { reservationMinor: 250, policyScope: "legacy" },
      applicationFeeCents: 300,
      isPayAsYouGoStore: true,
    }),
    { feeCents: 250, policyScope: "legacy" },
  );
});

test("a legacy payment without facts: the whole application fee, on a pay-as-you-go store only", () => {
  assert.deepEqual(
    paygFeeOfPayment({ feeFacts: null, applicationFeeCents: 300, isPayAsYouGoStore: true }),
    { feeCents: 300, policyScope: "legacy" },
  );
  assert.equal(
    paygFeeOfPayment({ feeFacts: null, applicationFeeCents: 300, isPayAsYouGoStore: false }),
    null,
  );
});

test("no commission, no event", () => {
  assert.equal(
    paygFeeOfPayment({
      feeFacts: { reservationMinor: 0, policyScope: "store" },
      applicationFeeCents: 0,
      isPayAsYouGoStore: true,
    }),
    null,
  );
  assert.equal(
    paygFeeOfPayment({ feeFacts: null, applicationFeeCents: 0, isPayAsYouGoStore: true }),
    null,
  );
});
