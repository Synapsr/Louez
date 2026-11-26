import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { getRentalBalance } from "./util.rental-amount";

// Where the customer stands on the rental: what settles it, and what is still
// owed, in the reservation's currency. The account, its pay button and the
// payment session read it; the dashboard reads the same two helpers.

type Row = Parameters<typeof getRentalBalance>[0]["payments"][number];

const rental = (amount: string, overrides: Partial<Row> = {}): Row => ({
  type: "rental",
  status: "completed",
  amount,
  method: "stripe",
  currency: "EUR",
  ...overrides,
});

const balance = (totalAmount: string, payments: Row[], currency = "EUR") =>
  getRentalBalance({ totalAmount, payments }, currency);

describe("getRentalBalance", () => {
  test("a deposit leaves the balance due, and the balance paid settles it", () => {
    const deposit = rental("9.00", { id: "deposit" });
    assert.deepEqual(balance("30.00", [deposit]), { paid: 9, due: 21 });
    assert.deepEqual(balance("30.00", [deposit, rental("21.00", { id: "balance" })]), {
      paid: 30,
      due: 0,
    });
  });

  test("several partial payments add up, in whole hundredths", () => {
    assert.deepEqual(
      balance("30.00", [rental("10.10"), rental("5.20", { method: "cash" }), rental("4.70")]),
      { paid: 20, due: 10 },
    );
    // 0.10 + 0.20 leaves exactly 0.70 of 1.00, not a float below.
    assert.equal(balance("1.00", [rental("0.10"), rental("0.20")]).due, 0.7);
  });

  test("a refunded part is owed again, as the dashboard reads it", () => {
    const paid = rental("30.00", { id: "paid" });
    const refund = rental("10.00", { id: "refund", refundOfPaymentId: "paid" });
    assert.deepEqual(balance("30.00", [paid, refund]), { paid: 20, due: 10 });
    // A refund Stripe reported failed gives nothing back.
    assert.deepEqual(balance("30.00", [paid, { ...refund, status: "failed" }]), {
      paid: 30,
      due: 0,
    });
  });

  test("only money in the reservation's currency settles it", () => {
    // Dollars taken while the store was on dollars are not the euros owed.
    assert.deepEqual(balance("30.00", [rental("9.00", { currency: "USD" })]), { paid: 0, due: 30 });
    // A payment outside Stripe is in the reservation's currency, whatever its column says.
    assert.deepEqual(
      balance("30.00", [rental("9.00", { method: "cash", currency: "EUR" })], "USD"),
      {
        paid: 9,
        due: 21,
      },
    );
    // Yen, which have no decimals.
    assert.deepEqual(balance("10000.00", [rental("3000.00", { currency: "JPY" })], "JPY"), {
      paid: 3000,
      due: 7000,
    });
  });

  test("a payment in progress, failed or cancelled settles nothing", () => {
    for (const status of ["pending", "failed", "cancelled"]) {
      assert.deepEqual(
        balance("30.00", [rental("9.00", { status })]),
        { paid: 0, due: 30 },
        status,
      );
    }
    assert.deepEqual(balance("30.00", [rental("9.00"), rental("21.00", { status: "pending" })]), {
      paid: 9,
      due: 21,
    });
  });

  test("deposits and damage fees are not the rental", () => {
    assert.deepEqual(
      balance("30.00", [
        rental("300.00", { type: "deposit" }),
        rental("50.00", { type: "damage" }),
      ]),
      { paid: 0, due: 30 },
    );
  });

  test("a total lowered after payment owes nothing, never a negative balance", () => {
    assert.deepEqual(balance("20.00", [rental("30.00")]), { paid: 30, due: 0 });
    assert.deepEqual(balance("0.00", []), { paid: 0, due: 0 });
  });
});
