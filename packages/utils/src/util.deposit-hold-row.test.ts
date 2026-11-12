import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  depositHoldRowKind,
  describeDepositHoldRow,
  isCustomerDepositHoldRow,
  paymentRowStatus,
  withLatestFailedHoldOnly,
} from "./util.deposit-hold-row";

const hold = (status: string, values: Record<string, unknown> = {}) => ({
  type: "deposit_hold",
  status,
  stripePaymentIntentId: "pi_hold",
  ...values,
});

describe("a deposit hold row, as a reader states it", () => {
  test("its kind follows its status, and the release Louez still owes", () => {
    assert.equal(depositHoldRowKind(hold("pending", { stripePaymentIntentId: null })), "unconfirmed");
    assert.equal(depositHoldRowKind(hold("failed")), "failed");
    assert.equal(depositHoldRowKind(hold("authorized")), "held");
    assert.equal(depositHoldRowKind(hold("authorized", { releaseOwedAt: null })), "held");
    assert.equal(
      depositHoldRowKind(hold("authorized", { releaseOwedAt: new Date() })),
      "release_pending",
    );
    assert.equal(
      depositHoldRowKind(hold("authorized", { releaseOwedAt: "2026-11-12 10:00:00" })),
      "release_pending",
    );
    assert.equal(depositHoldRowKind(hold("completed")), "captured");
    assert.equal(depositHoldRowKind(hold("cancelled")), "cancelled");
    // A status no hold is written with holds nothing.
    assert.equal(depositHoldRowKind(hold("refunded")), "cancelled");
  });

  test("any other payment row has no kind, and keeps its status", () => {
    const rental = { type: "rental", status: "pending" };
    assert.equal(depositHoldRowKind(rental), null);
    assert.equal(paymentRowStatus(rental), "pending");
    assert.equal(paymentRowStatus({ type: "deposit_capture", status: "completed" }), "completed");
  });

  test("a list never states an attempt, a refusal or a second authorization as a hold", () => {
    assert.equal(paymentRowStatus(hold("authorized")), "authorized");
    assert.equal(paymentRowStatus(hold("completed")), "completed");
    assert.equal(paymentRowStatus(hold("pending")), "unconfirmed");
    assert.equal(paymentRowStatus(hold("failed")), "failed");
    assert.equal(paymentRowStatus(hold("cancelled")), "cancelled");
    assert.equal(
      paymentRowStatus(hold("authorized", { releaseOwedAt: new Date() })),
      "release_pending",
    );
    for (const kind of ["unconfirmed", "failed", "release_pending", "cancelled"] as const) {
      assert.doesNotMatch(describeDepositHoldRow(kind), /^authorized|is held on the card/);
    }
  });

  test("a customer is shown the hold their card carries, its capture and its release only", () => {
    const shown = (row: ReturnType<typeof hold>, reference: string | null = "pi_hold") =>
      isCustomerDepositHoldRow(row, reference);

    assert.equal(shown(hold("authorized")), true);
    assert.equal(shown(hold("completed")), true);
    // The reservation's hold, released.
    assert.equal(shown(hold("cancelled")), true);
    // A PaymentIntent that never was the reservation's hold, or an older one.
    assert.equal(shown(hold("cancelled", { stripePaymentIntentId: "pi_other" })), false);
    assert.equal(shown(hold("cancelled"), null), false);
    assert.equal(shown(hold("cancelled", { stripePaymentIntentId: null }), null), false);
    assert.equal(shown(hold("pending", { stripePaymentIntentId: null })), false);
    assert.equal(shown(hold("failed")), false);
    assert.equal(shown(hold("authorized", { releaseOwedAt: new Date() })), false);
    // Not a hold: not this function's to show.
    assert.equal(isCustomerDepositHoldRow({ type: "rental", status: "completed" }, null), false);
  });

  test("the store's history keeps the latest refused or closed hold only", () => {
    const failed = (id: string, createdAt: string) => ({
      id,
      type: "deposit_hold",
      status: "failed",
      createdAt: new Date(createdAt),
    });
    const rows = [
      failed("closed_first", "2026-03-01T10:00:00Z"),
      { id: "rental", type: "rental", status: "completed", createdAt: new Date("2026-03-01T09:00:00Z") },
      failed("refused_last", "2026-03-03T10:00:00Z"),
      { id: "held", type: "deposit_hold", status: "authorized", createdAt: new Date("2026-03-04T10:00:00Z") },
      failed("closed_between", "2026-03-02T10:00:00Z"),
    ];

    assert.deepEqual(
      withLatestFailedHoldOnly(rows).map((row) => row.id),
      ["rental", "refused_last", "held"],
    );
    // A failed rental payment is not a hold: it stays.
    const rentalFailed = { id: "r", type: "rental", status: "failed", createdAt: new Date() };
    assert.deepEqual(withLatestFailedHoldOnly([rentalFailed, ...rows]).length, 4);
  });
});
