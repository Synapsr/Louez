import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  getReservationPaymentStatus,
  getTotalPaid,
  hasRentalPaymentInProgress,
  isRentalPaid,
} from "./util.payment-status";

describe("isRentalPaid", () => {
  test("only a completed rental payment counts", () => {
    assert.equal(isRentalPaid([{ type: "rental", status: "completed", amount: "10" }]), true);
    assert.equal(isRentalPaid([{ type: "deposit", status: "completed", amount: "10" }]), false);
    assert.equal(isRentalPaid([{ type: "rental", status: "pending", amount: "10" }]), false);
    assert.equal(isRentalPaid([]), false);
  });
});

describe("getReservationPaymentStatus", () => {
  test("paid beats processing beats unpaid", () => {
    assert.equal(
      getReservationPaymentStatus([
        { type: "rental", status: "pending", amount: "10" },
        { type: "rental", status: "completed", amount: "10" },
      ]),
      "paid",
    );
    assert.equal(
      getReservationPaymentStatus([{ type: "rental", status: "pending", amount: "10" }]),
      "processing",
    );
    assert.equal(
      getReservationPaymentStatus([{ type: "rental", status: "failed", amount: "10" }]),
      "unpaid",
    );
    assert.equal(
      hasRentalPaymentInProgress([{ type: "deposit", status: "pending", amount: "1" }]),
      false,
    );
  });
});

describe("getTotalPaid", () => {
  test("sums completed payments and subtracts refunds", () => {
    assert.equal(
      getTotalPaid([
        { type: "rental", status: "completed", amount: "100.50" },
        { type: "deposit", status: "completed", amount: 200 },
        { type: "deposit_return", status: "completed", amount: "200" },
        { type: "rental", status: "pending", amount: "999" },
        { type: "rental", status: "completed", amount: "abc" },
      ]),
      100.5,
    );
  });
});
