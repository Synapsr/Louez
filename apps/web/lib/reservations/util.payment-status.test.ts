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
  isStripeRefundRow,
} from "./util.payment-status";

/** A Stripe refund as the webhook records it: its own positive row carrying only the refund id. */
const stripeRefund = (amount: string, type = "rental") => ({
  type,
  status: "completed",
  amount,
  stripeRefundId: "re_1",
  stripePaymentIntentId: null,
  stripeCheckoutSessionId: null,
});

describe("isRentalPaid", () => {
  test("only a completed rental payment counts", () => {
    assert.equal(isRentalPaid([{ type: "rental", status: "completed", amount: "10" }]), true);
    assert.equal(isRentalPaid([{ type: "deposit", status: "completed", amount: "10" }]), false);
    assert.equal(isRentalPaid([{ type: "rental", status: "pending", amount: "10" }]), false);
    assert.equal(isRentalPaid([]), false);
  });

  test("a refund row never makes a rental paid", () => {
    // Fully refunded through Stripe: the charge is `refunded`, only the refund row is completed.
    assert.equal(
      isRentalPaid([
        { type: "rental", status: "refunded", amount: "0", stripePaymentIntentId: "pi_1" },
        stripeRefund("100"),
      ]),
      false,
    );
    assert.equal(
      isRentalPaid([{ type: "rental", status: "completed", amount: "10", refundOfPaymentId: "a" }]),
      false,
    );
  });

  test("with the reservation's currency, a card payment in another currency pays nothing", () => {
    const paid = (method: string, currency: string | null) => [
      { type: "rental", status: "completed", amount: "10", method, currency },
    ];

    assert.equal(isRentalPaid(paid("stripe", "USD"), "EUR"), false);
    assert.equal(getRentalPaid(paid("stripe", "USD"), "EUR"), 0);
    assert.equal(isRentalPaid(paid("stripe", "eur"), "EUR"), true);
    // A Stripe payment with no stored currency, and any payment outside Stripe, are in
    // the reservation's currency: older manual rows kept the column's EUR default.
    assert.equal(isRentalPaid(paid("stripe", null), "USD"), true);
    assert.equal(isRentalPaid(paid("cash", "EUR"), "USD"), true);
    assert.equal(getRentalPaid(paid("cash", "EUR"), "USD"), 10);
    // Without a currency, or with rows loaded without theirs, nothing is left out.
    assert.equal(isRentalPaid(paid("stripe", "USD")), true);
    assert.equal(
      isRentalPaid([{ type: "rental", status: "completed", amount: "10" }], "EUR"),
      true,
    );
  });
});

describe("isStripeRefundRow", () => {
  test("needs the refund id and no id of the charge", () => {
    assert.equal(isStripeRefundRow(stripeRefund("30")), true);
    // Older webhooks stamped the refund id on the netted charge itself.
    assert.equal(
      isStripeRefundRow({
        ...stripeRefund("70"),
        stripePaymentIntentId: "pi_1",
      }),
      false,
    );
    assert.equal(
      isStripeRefundRow({ ...stripeRefund("70"), stripeCheckoutSessionId: "cs_1" }),
      false,
    );
    assert.equal(isStripeRefundRow({}), false);
  });

  test("stays off when the charge ids were not loaded, so a receipt is never dropped by mistake", () => {
    assert.equal(isStripeRefundRow({ stripeRefundId: "re_1" }), false);
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

  test("a Stripe refund row is neither added nor subtracted: its charge is already net", () => {
    assert.equal(
      getRentalPaid([
        {
          id: "a",
          type: "rental",
          status: "completed",
          amount: "70",
          stripePaymentIntentId: "pi_1",
        },
        { id: "b", ...stripeRefund("30") },
      ]),
      70,
    );
    // Same once the refund row also points at its charge.
    assert.equal(
      getRentalPaid([
        {
          id: "a",
          type: "rental",
          status: "completed",
          amount: "70",
          stripePaymentIntentId: "pi_1",
        },
        { id: "b", ...stripeRefund("30"), refundOfPaymentId: "a" },
      ]),
      70,
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
    assert.deepEqual(getCustomerPaymentRows([hold, capture], "pi_hold"), [capture]);
    assert.deepEqual(getCustomerPaymentRows([hold], "pi_hold"), [hold]);
    const live = { id: "h", type: "deposit_hold", status: "authorized", amount: "100" };
    assert.deepEqual(getCustomerPaymentRows([live], "pi_hold"), [live]);
  });

  test("of the deposit holds, the customer reads the one their card carries, and its release", () => {
    const row = (id: string, status: string, values: Record<string, unknown> = {}) => ({
      id,
      type: "deposit_hold",
      status,
      amount: "100",
      stripePaymentIntentId: `pi_${id}`,
      ...values,
    });
    const rental = { id: "r", type: "rental", status: "completed", amount: "80" };
    const held = row("held", "authorized");
    const released = row("released", "cancelled");
    const rows = [
      rental,
      // Asked by the store, never confirmed by Stripe.
      row("attempt", "pending", { stripePaymentIntentId: null }),
      row("refused", "failed"),
      // A second authorization, being released.
      row("second", "authorized", { releaseOwedAt: new Date() }),
      // A PaymentIntent that never was the reservation's hold.
      row("never", "cancelled"),
    ];

    assert.deepEqual(getCustomerPaymentRows([...rows, held], "pi_held"), [rental, held]);
    assert.deepEqual(getCustomerPaymentRows([...rows, released], "pi_released"), [
      rental,
      released,
    ]);
    assert.deepEqual(getCustomerPaymentRows(rows, null), [rental]);
  });

  test("a refund is any row pointing at another, or a deposit return", () => {
    assert.equal(
      isRefundRow({ type: "rental", status: "completed", amount: 1, refundOfPaymentId: "a" }),
      true,
    );
    assert.equal(isRefundRow({ type: "deposit_return", status: "completed", amount: 1 }), true);
    assert.equal(isRefundRow({ type: "rental", status: "completed", amount: 1 }), false);
    assert.equal(isRefundRow(stripeRefund("30")), true);
  });
});
