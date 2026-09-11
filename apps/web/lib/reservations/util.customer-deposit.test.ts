import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canAuthorizeDepositOnline,
  getCustomerDepositView,
  type DepositPaymentLike,
} from "./util.customer-deposit";

const now = new Date("2026-09-11T10:00:00Z");
const day = (offset: number) => new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);

const payment = (overrides: Partial<DepositPaymentLike>): DepositPaymentLike => ({
  type: "deposit",
  status: "completed",
  method: "cash",
  amount: "100",
  notes: null,
  paidAt: now,
  createdAt: now,
  ...overrides,
});

const view = (
  depositStatus: string | null,
  payments: DepositPaymentLike[] = [],
  expiresAt: Date | null = null,
) =>
  getCustomerDepositView({
    depositAmount: "100",
    depositStatus,
    depositAuthorizationExpiresAt: expiresAt,
    payments,
    now,
  });

test("no deposit and no manual deposit reads as not required", () => {
  assert.deepEqual(
    getCustomerDepositView({
      depositAmount: "0",
      depositStatus: "none",
      depositAuthorizationExpiresAt: null,
      payments: [],
      now,
    }),
    { kind: "not_required" },
  );
});

test("card states map to their customer reading", () => {
  assert.equal(view("pending").kind, "to_provide");
  assert.equal(view(null).kind, "to_provide");
  assert.equal(view("card_saved").kind, "card_saved");
  assert.equal(view("failed").kind, "failed");
  assert.equal(view("released").kind, "released");
});

test("a live hold carries its expiry, an expired one reads as expired", () => {
  assert.deepEqual(view("authorized", [], day(3)), {
    kind: "held",
    amount: 100,
    expiresAt: day(3),
  });
  assert.equal(view("authorized", [], day(-1)).kind, "hold_expired");
});

test("a capture shows the amount taken, the rest released and the reason", () => {
  const captured = view("captured", [
    payment({ type: "deposit_hold", status: "completed", method: "stripe" }),
    payment({
      type: "deposit_capture",
      method: "stripe",
      amount: "40",
      notes: "Rayure sur le cadre",
      paidAt: day(-2),
    }),
  ]);
  assert.deepEqual(captured, {
    kind: "captured",
    amount: 100,
    capturedAmount: 40,
    releasedAmount: 60,
    reason: "Rayure sur le cadre",
    capturedAt: day(-2),
  });
});

test("a capture without its payment row assumes the full deposit", () => {
  const captured = view("captured");
  assert.equal(captured.kind, "captured");
  if (captured.kind === "captured") {
    assert.equal(captured.capturedAmount, 100);
    assert.equal(captured.releasedAmount, 0);
    assert.equal(captured.reason, null);
  }
});

test("a manual deposit wins over an unresolved card state", () => {
  const collected = view("pending", [payment({ method: "check", paidAt: day(-1) })]);
  assert.deepEqual(collected, {
    kind: "collected",
    amount: 100,
    method: "check",
    receivedAt: day(-1),
  });
});

test("a manual deposit given back reads as returned, partially when short", () => {
  const returned = view("pending", [
    payment({ paidAt: day(-5) }),
    payment({ type: "deposit_return", amount: "60", method: "transfer", paidAt: day(-1) }),
  ]);
  assert.deepEqual(returned, {
    kind: "returned",
    amount: 100,
    returnedAmount: 60,
    method: "transfer",
    returnedAt: day(-1),
    partial: true,
  });
});

test("a pending deposit payment does not count as collected", () => {
  assert.equal(view("pending", [payment({ status: "pending" })]).kind, "to_provide");
});

test("online authorisation opens seven days before pickup on confirmed rentals", () => {
  const base = {
    view: view("pending"),
    status: "confirmed",
    stripeActive: true,
    now,
  };
  assert.equal(canAuthorizeDepositOnline({ ...base, startDate: day(6) }), true);
  assert.equal(canAuthorizeDepositOnline({ ...base, startDate: day(8) }), false);
  assert.equal(canAuthorizeDepositOnline({ ...base, startDate: day(-1), status: "ongoing" }), true);
  assert.equal(canAuthorizeDepositOnline({ ...base, startDate: day(1), status: "pending" }), false);
  assert.equal(
    canAuthorizeDepositOnline({ ...base, startDate: day(1), stripeActive: false }),
    false,
  );
  assert.equal(
    canAuthorizeDepositOnline({ ...base, startDate: day(1), view: view("authorized", [], day(3)) }),
    false,
  );
  assert.equal(
    canAuthorizeDepositOnline({ ...base, startDate: day(1), view: view("failed") }),
    true,
  );
});
