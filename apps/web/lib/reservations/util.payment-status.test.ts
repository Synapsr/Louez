import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { getSettledPaymentAmount } from "@louez/utils";

import {
  getCustomerPaymentRows,
  getDamageFees,
  getDepositTotals,
  getRentalPaid,
  getReservationPaymentStatus,
  hasRentalPaymentInProgress,
  isFailedRefundRow,
  isRefundRow,
  isStripeRefundRow,
  readPaymentRow,
  refundedPaymentState,
  refundStatusByRow,
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
  const session = "cs_test_balance";
  const ofSession = (status: string, extra: Record<string, unknown> = {}) => ({
    type: "rental",
    status,
    amount: "10",
    stripeCheckoutSessionId: session,
    ...extra,
  });

  test("that session's payment: received beats processing beats unpaid", () => {
    assert.equal(
      getReservationPaymentStatus([ofSession("pending"), ofSession("completed")], session),
      "received",
    );
    assert.equal(getReservationPaymentStatus([ofSession("pending")], session), "processing");
    assert.equal(getReservationPaymentStatus([ofSession("failed")], session), "unpaid");
    assert.equal(
      hasRentalPaymentInProgress([{ type: "deposit", status: "pending", amount: "1" }]),
      false,
    );
  });

  test("only the session the landing names counts: a deposit received earlier never reads as the payment just made", () => {
    const payments = [
      { type: "rental", status: "completed", amount: "9", stripeCheckoutSessionId: "cs_deposit" },
      { type: "rental", status: "pending", amount: "21", stripeCheckoutSessionId: "cs_balance" },
    ];
    // The deposit was received; the balance is still on its way.
    assert.equal(getReservationPaymentStatus(payments, "cs_balance"), "processing");
    assert.equal(getReservationPaymentStatus(payments, "cs_deposit"), "received");
    assert.equal(getReservationPaymentStatus(payments, "cs_unknown"), "unpaid");
  });

  test("a link that names no session, or names it badly, says nothing", () => {
    const deposit = [ofSession("completed")];
    for (const [name, value] of [
      ["absent", undefined],
      ["empty", null],
      ["given twice", [session, session]],
      ["malformed", "pi_not_a_session"],
      ["with other characters", `${session}"><script>`],
      ["oversized", `cs_${"a".repeat(253)}`],
    ] as const) {
      assert.equal(getReservationPaymentStatus(deposit, value), "unpaid", name);
    }
  });

  test("a security deposit or a refund row is no rental payment received", () => {
    assert.equal(
      getReservationPaymentStatus([{ ...ofSession("completed"), type: "deposit" }], session),
      "unpaid",
    );
    // Fully refunded through Stripe: the charge is `refunded`, only the refund row is completed.
    assert.equal(
      getReservationPaymentStatus(
        [ofSession("refunded", { amount: "0" }), stripeRefund("100")],
        session,
      ),
      "unpaid",
    );
    assert.equal(
      getReservationPaymentStatus([ofSession("completed", { refundOfPaymentId: "a" })], session),
      "unpaid",
    );
  });
});

describe("getRentalPaid", () => {
  test("counts completed rental money only, refunds of it subtracted", () => {
    assert.equal(
      getRentalPaid(
        [
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
        ],
        "EUR",
      ),
      80.5,
    );
  });

  test("a Stripe refund row is neither added nor subtracted: its charge is already net", () => {
    assert.equal(
      getRentalPaid(
        [
          {
            id: "a",
            type: "rental",
            status: "completed",
            amount: "70",
            stripePaymentIntentId: "pi_1",
          },
          { id: "b", ...stripeRefund("30") },
        ],
        "EUR",
      ),
      70,
    );
    // Same once the refund row also points at its charge.
    assert.equal(
      getRentalPaid(
        [
          {
            id: "a",
            type: "rental",
            status: "completed",
            amount: "70",
            stripePaymentIntentId: "pi_1",
          },
          { id: "b", ...stripeRefund("30"), refundOfPaymentId: "a" },
        ],
        "EUR",
      ),
      70,
    );
  });
});

describe("getDepositTotals", () => {
  test("a return linked to a deposit that failed gives back nothing held, as the cancellation preview reads it", () => {
    const payments = [
      { id: "held", type: "deposit", status: "completed", amount: "60.00" },
      { id: "failed", type: "deposit", status: "failed", amount: "40.00" },
      {
        id: "return",
        type: "deposit_return",
        status: "completed",
        amount: "20.00",
        refundOfPaymentId: "failed",
      },
    ];

    assert.deepEqual(getDepositTotals(payments), { collected: 60, returned: 0, held: 60 });
    // The cancellation preview's reading of the same rows.
    assert.equal(
      getSettledPaymentAmount(payments, "deposit") -
        getSettledPaymentAmount(payments, "deposit_return"),
      60,
    );
  });

  test("a Stripe refund of a deposit is returned money, and its deposit already reads net", () => {
    const refund = (amount: string) => ({
      ...stripeRefund(amount, "deposit_return"),
      refundOfPaymentId: "card",
    });
    // 100 taken by card, 30 refunded: the webhook brought the deposit down to 70.
    assert.deepEqual(
      getDepositTotals([
        {
          id: "card",
          type: "deposit",
          status: "completed",
          amount: "70.00",
          stripePaymentIntentId: "pi_1",
        },
        refund("30.00"),
      ]),
      { collected: 70, returned: 30, held: 70 },
    );
    // Refunded in full: nothing is held any more, and the 100 went back.
    assert.deepEqual(
      getDepositTotals([
        {
          id: "card",
          type: "deposit",
          status: "refunded",
          amount: "0.00",
          stripePaymentIntentId: "pi_1",
        },
        refund("100.00"),
      ]),
      { collected: 0, returned: 100, held: 0 },
    );
  });

  test("returns linked to a deposit and returns made apart both go back", () => {
    assert.deepEqual(
      getDepositTotals([
        { id: "held", type: "deposit", status: "completed", amount: "100.00" },
        {
          id: "linked",
          type: "deposit_return",
          status: "completed",
          amount: "30.00",
          refundOfPaymentId: "held",
        },
        { id: "apart", type: "deposit_return", status: "completed", amount: "20.00" },
      ]),
      { collected: 100, returned: 50, held: 50 },
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

describe("a refund that failed", () => {
  const failed = { ...stripeRefund("60.00"), status: "failed" };
  const charge = {
    id: "pay_charge",
    type: "rental",
    status: "completed",
    amount: "100.00",
    stripePaymentIntentId: "pi_1",
    stripeCheckoutSessionId: null,
    stripeRefundId: null,
  };

  test("is told apart from one that gave money back, and from a payment that failed", () => {
    assert.equal(isFailedRefundRow(failed), true);
    assert.equal(isFailedRefundRow({ ...failed, refundOfPaymentId: "pay_charge" }), true);
    assert.equal(isFailedRefundRow(stripeRefund("60.00")), false);
    assert.equal(isFailedRefundRow({ ...charge, status: "failed" }), false);
  });

  test("is left out for the customer when its operation failed, though its row was read completed", () => {
    // The row read completed, then the operation read failed: Stripe failed it in between.
    const completed = { ...stripeRefund("25.00"), id: "pay_refund", method: "stripe" };
    assert.deepEqual(
      getCustomerPaymentRows(
        [charge, completed],
        null,
        refundStatusByRow([{ refundPaymentId: "pay_refund", status: "failed" }]),
      ).map((row) => row.id),
      ["pay_charge"],
    );
  });

  test("is not shown to the customer as money given back", () => {
    assert.deepEqual(
      getCustomerPaymentRows([charge, failed, stripeRefund("10.00")], null).map(
        (row) => row.status,
      ),
      ["completed", "completed"],
    );
  });
});

describe("readPaymentRow: what a row is, the one reading of the card, the history and the customer's page", () => {
  const charge = {
    id: "pay_charge",
    type: "rental",
    method: "stripe",
    status: "completed",
    amount: "32.00",
    stripePaymentIntentId: "pi_1",
    stripeCheckoutSessionId: "cs_1",
    stripeRefundId: null,
    refundOfPaymentId: null,
  };
  // Since 2026-08: the charge netted, the refund a row of its own linked to it.
  const linked = (fields: Record<string, unknown> = {}) => ({
    ...stripeRefund("10.00"),
    id: "pay_refund",
    method: "stripe",
    refundOfPaymentId: "pay_charge",
    ...fields,
  });
  const statuses = (status: "pending" | "succeeded" | "failed") =>
    refundStatusByRow([{ refundPaymentId: "pay_refund", status }]);

  test("money the store took is a receipt, a deposit hold a hold", () => {
    assert.deepEqual(readPaymentRow(charge), { kind: "receipt" });
    assert.deepEqual(
      readPaymentRow({
        ...charge,
        method: "cash",
        stripePaymentIntentId: null,
        stripeCheckoutSessionId: null,
      }),
      { kind: "receipt" },
    );
    assert.deepEqual(readPaymentRow({ ...charge, type: "deposit_capture" }), { kind: "receipt" });
    assert.deepEqual(readPaymentRow({ ...charge, type: "deposit_hold", status: "authorized" }), {
      kind: "hold",
    });
  });

  test("the oldest webhooks' charge, stamped with its refund's id and netted, is still the charge", () => {
    assert.deepEqual(readPaymentRow({ ...charge, stripeRefundId: "re_old" }), { kind: "receipt" });
  });

  test("each shape of refund reads as a refund: made when the store gave it, issued when Stripe holds the word", () => {
    const done = { kind: "refund", state: "done" };
    const issued = { kind: "refund", state: "issued" };
    // Given by hand: a row pointing at the payment it gives back.
    assert.deepEqual(
      readPaymentRow({
        id: "r",
        type: "rental",
        method: "cash",
        status: "completed",
        amount: "10.00",
        refundOfPaymentId: "p",
      }),
      done,
    );
    // The dashboard's Stripe refund before 2026-08: its own row, with no link to the charge,
    // and no operation: Stripe made it, whether it settled Louez does not know.
    assert.deepEqual(readPaymentRow({ ...stripeRefund("10.00"), method: "stripe" }), issued);
    // Since 2026-08: its own row linked to the charge.
    assert.deepEqual(readPaymentRow(linked()), issued);
    assert.deepEqual(readPaymentRow(linked(), statuses("succeeded")), done);
    // A deposit given back by hand, and through Stripe.
    assert.deepEqual(
      readPaymentRow({
        id: "d",
        type: "deposit_return",
        method: "cash",
        status: "completed",
        amount: "50.00",
      }),
      done,
    );
    assert.deepEqual(readPaymentRow(linked({ type: "deposit_return" })), issued);
  });

  test("a refund Stripe has not settled is in progress, not done, though its row is completed", () => {
    assert.deepEqual(readPaymentRow(linked(), statuses("pending")), {
      kind: "refund",
      state: "processing",
    });
    assert.deepEqual(readPaymentRow(linked(), statuses("succeeded")), {
      kind: "refund",
      state: "done",
    });
  });

  test("a refund made in Stripe's own dashboard is issued, not made, while Stripe says nothing more", () => {
    // Recorded by the webhook as a completed row, with no operation of Louez's: Stripe may
    // still call it pending. Nothing stored tells it settled.
    assert.deepEqual(readPaymentRow(linked(), refundStatusByRow([])), {
      kind: "refund",
      state: "issued",
    });
    // When Stripe fails it, its row is failed, and it reads failed.
    assert.deepEqual(readPaymentRow(linked({ status: "failed" }), refundStatusByRow([])), {
      kind: "refund",
      state: "failed",
    });
    // A refund the store records by hand is its own word: made.
    assert.deepEqual(
      readPaymentRow(
        {
          id: "h",
          type: "rental",
          method: "transfer",
          status: "completed",
          amount: "5.00",
          refundOfPaymentId: "p",
        },
        refundStatusByRow([]),
      ),
      { kind: "refund", state: "done" },
    );
  });

  test("a refund Stripe failed afterwards gave nothing back", () => {
    assert.deepEqual(readPaymentRow(linked({ status: "failed" }), statuses("failed")), {
      kind: "refund",
      state: "failed",
    });
    assert.deepEqual(readPaymentRow(linked({ status: "failed" })), {
      kind: "refund",
      state: "failed",
    });
    assert.deepEqual(readPaymentRow({ ...stripeRefund("10.00"), status: "cancelled" }), {
      kind: "refund",
      state: "failed",
    });
  });

  test("an operation that has not made its row yet names no row", () => {
    assert.equal(refundStatusByRow([{ refundPaymentId: null, status: "pending" }]).size, 0);
  });
});

describe("refundedPaymentState: a payment Stripe counts as refunded in full reads refunded only when every refund of it is known made", () => {
  const charge = {
    id: "pay_charge",
    type: "rental",
    method: "stripe",
    status: "refunded",
    amount: "0.00",
    stripePaymentIntentId: "pi_1",
    stripeCheckoutSessionId: null,
    stripeRefundId: null,
    refundOfPaymentId: null,
  };
  // A Louez refund: its own row, linked to the charge.
  const linked = (id: string, amount = "50.00", fields: Record<string, unknown> = {}) => ({
    ...stripeRefund(amount),
    stripeRefundId: `re_${id}`,
    id,
    method: "stripe",
    refundOfPaymentId: "pay_charge",
    ...fields,
  });
  const ops = (...rows: [string, "pending" | "succeeded" | "failed"][]) =>
    rows.map(([refundPaymentId, status]) => ({ refundPaymentId, status }));

  test("one linked Louez refund that succeeded: refunded", () => {
    const rows = [charge, linked("r1", "100.00")];
    assert.equal(refundedPaymentState(charge, rows, ops(["r1", "succeeded"])), "done");
  });

  test("two linked refunds, both made: refunded", () => {
    const rows = [charge, linked("r1"), linked("r2")];
    assert.equal(
      refundedPaymentState(charge, rows, ops(["r1", "succeeded"], ["r2", "succeeded"])),
      "done",
    );
  });

  test("one linked refund only issued, or still in progress, beside one made: issued", () => {
    const rows = [charge, linked("r1"), linked("r2")];
    assert.equal(refundedPaymentState(charge, rows, ops(["r1", "succeeded"])), "issued");
    assert.equal(
      refundedPaymentState(charge, rows, ops(["r1", "succeeded"], ["r2", "pending"])),
      "issued",
    );
  });

  test("an old unlinked Stripe refund of the reservation may be this payment's: issued", () => {
    // 100.00: an old 30.00 refund with its own row and no link, then a 70.00 Louez refund
    // that succeeded. Which payment the 30.00 came off, the rows cannot tell.
    const old = {
      ...stripeRefund("30.00"),
      id: "r_old",
      stripeRefundId: "re_old",
      method: "stripe",
    };
    const rows = [charge, old, linked("r1", "70.00")];
    assert.equal(refundedPaymentState(charge, rows, ops(["r1", "succeeded"])), "issued");
  });

  test("the oldest shape, a refund id stamped on the payment itself: issued", () => {
    const stamped = { ...charge, stripeRefundId: "re_old" };
    const rows = [stamped, linked("r1", "70.00")];
    assert.equal(refundedPaymentState(stamped, rows, ops(["r1", "succeeded"])), "issued");
    assert.equal(refundedPaymentState(stamped, [stamped], []), "issued");
  });

  test("two refunds read completed, then one failed between the two reads: issued", () => {
    // The page read both 50.00 rows completed; the operations read one succeeded, one failed.
    const rows = [charge, linked("r1"), linked("r2")];
    assert.equal(
      refundedPaymentState(charge, rows, ops(["r1", "succeeded"], ["r2", "failed"])),
      "issued",
    );
  });

  test("no refund of it has a row: issued", () => {
    assert.equal(refundedPaymentState(charge, [charge], []), "issued");
  });

  test("refunds given by hand are the store's word", () => {
    const cash = { ...charge, method: "cash", stripePaymentIntentId: null };
    const back = {
      id: "h",
      type: "rental",
      method: "cash",
      status: "completed",
      amount: "50.00",
      refundOfPaymentId: "pay_charge",
    };
    assert.equal(refundedPaymentState(cash, [cash, back], []), "done");
  });
});
