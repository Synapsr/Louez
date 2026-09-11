import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  getCustomerPaymentRows,
  getDamageFees,
  getRentalPaid,
  getReservationPaymentStatus,
  hasRentalPaymentInProgress,
  isRefundRow,
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

describe("getRentalPaid", () => {
  test("counts completed rental money only, refunds of it subtracted", () => {
    assert.equal(
      getRentalPaid([
        { id: "a", type: "rental", status: "completed", amount: "100.50" },
        { id: "b", type: "deposit", status: "completed", amount: 200 },
        { id: "c", type: "deposit_return", status: "completed", amount: "200" },
        { id: "d", type: "rental", status: "pending", amount: "999" },
        { id: "e", type: "rental", status: "completed", amount: "abc" },
        { id: "f", type: "rental", status: "completed", amount: "20", refundOfPaymentId: "a" },
        { id: "g", type: "damage", status: "completed", amount: "30" },
        {
          id: "h",
          type: "deposit_return",
          status: "completed",
          amount: "5",
          refundOfPaymentId: "x",
        },
      ]),
      80.5,
    );
  });
});

describe("getDamageFees", () => {
  test("sums damage fees and subtracts their refunds", () => {
    assert.equal(
      getDamageFees([
        { id: "a", type: "damage", status: "completed", amount: "30" },
        { id: "b", type: "rental", status: "completed", amount: "10", refundOfPaymentId: "a" },
        { id: "c", type: "damage", status: "pending", amount: "99" },
      ]),
      20,
    );
  });
});

describe("getCustomerPaymentRows", () => {
  test("drops a captured hold once the capture row exists", () => {
    const hold = { id: "h", type: "deposit_hold", status: "completed", amount: "100" };
    const capture = { id: "c", type: "deposit_capture", status: "completed", amount: "40" };
    assert.deepEqual(getCustomerPaymentRows([hold, capture]), [capture]);
    assert.deepEqual(getCustomerPaymentRows([hold]), [hold]);
    const live = { id: "h", type: "deposit_hold", status: "authorized", amount: "100" };
    assert.deepEqual(getCustomerPaymentRows([live]), [live]);
  });

  test("a refund is any row pointing at another, or a deposit return", () => {
    assert.equal(
      isRefundRow({ type: "rental", status: "completed", amount: 1, refundOfPaymentId: "a" }),
      true,
    );
    assert.equal(isRefundRow({ type: "deposit_return", status: "completed", amount: 1 }), true);
    assert.equal(isRefundRow({ type: "rental", status: "completed", amount: 1 }), false);
  });
});
