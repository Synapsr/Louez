import assert from "node:assert/strict";
import { test } from "node:test";

import { hasReservationInsuranceCoverage } from "./util.reservation-insurance";

test("products registered with Tulip do not insure an unselected pending reservation", () => {
  const reservation = {
    status: "pending",
    tulipInsuranceOptIn: false,
    tulipInsuranceAmount: null,
    tulipContractId: null,
    tulipContractStatus: null,
    items: [{ productId: "bike" }, { productId: "cargo-bike" }],
  };
  assert.equal(hasReservationInsuranceCoverage(reservation), false);
});

test("manual coverage is visible even when there is no public offer or customer charge", () => {
  const reservation = {
    publicMode: "no_public",
    tulipInsuranceOptIn: true,
    tulipInsuranceAmount: "0.00",
    tulipContractId: "contract-manual",
    tulipContractStatus: "created",
  };
  assert.equal(hasReservationInsuranceCoverage(reservation), true);
  assert.equal(
    hasReservationInsuranceCoverage({ ...reservation, tulipContractStatus: "updated" }),
    true,
  );
});

test("selecting or paying for coverage is insufficient before the contract exists", () => {
  const reservation = {
    tulipInsuranceOptIn: true,
    tulipInsuranceAmount: "7.50",
    tulipContractId: null,
    tulipContractStatus: null,
  };
  assert.equal(hasReservationInsuranceCoverage(reservation), false);
  assert.equal(
    hasReservationInsuranceCoverage({ ...reservation, tulipContractStatus: "creating" }),
    false,
  );
});

test("cancelled or failed coverage cannot be restored by old selection or billing fields", () => {
  for (const status of ["cancelled", "failed", "not_required", "creating", "unknown"]) {
    assert.equal(
      hasReservationInsuranceCoverage({
        tulipContractId: "stale-contract",
        tulipContractStatus: status,
      }),
      false,
    );
  }
});

test("legacy contract identifiers remain recognized without a lifecycle status", () => {
  assert.equal(
    hasReservationInsuranceCoverage({
      tulipContractId: "legacy-contract",
      tulipContractStatus: null,
    }),
    true,
  );
});

test("a missing or blank contract identifier never establishes coverage", () => {
  for (const id of [null, "", "   "]) {
    assert.equal(
      hasReservationInsuranceCoverage({ tulipContractId: id, tulipContractStatus: "created" }),
      false,
    );
  }
});
