import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildPaymentSnapshots,
  type DisputeRow,
  type LegacyFeeRow,
  type PaymentRow,
  type PaymentsInput,
} from "./reservation-payments";
import { SnapshotDataError, snapshotChecks } from "./snapshot-checks";

// The payments of a reservation snapshot, from rows (openapi.yaml Payment, README Q7).

const AT = new Date("2026-11-03T10:15:00Z");
const LATER = new Date("2026-11-05T08:00:00Z");

function row(overrides: Partial<PaymentRow> & Pick<PaymentRow, "id">): PaymentRow {
  return {
    type: "rental",
    method: "stripe",
    status: "completed",
    amount: "100.00",
    currency: "eur",
    stripePaymentIntentId: null,
    stripeChargeId: null,
    stripeCheckoutSessionId: null,
    stripeRefundId: null,
    refundOfPaymentId: null,
    grossMinor: null,
    insuranceShareMinor: null,
    origin: null,
    paymentRequestId: null,
    stripeAccountId: null,
    appFeeTotalMinor: null,
    appFeeReservationMinor: null,
    appFeeMarketplaceMinor: null,
    appFeeBaseMinor: null,
    appFeePolicyScope: null,
    appFeePolicyVersion: null,
    appFeeMetadataVersion: null,
    paidAt: AT,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

function build(rows: PaymentRow[], overrides: Partial<PaymentsInput> = {}) {
  return buildPaymentSnapshots({
    checks: snapshotChecks("reservation r1"),
    reservationId: "r1",
    reservationCurrency: "USD",
    totalInclTaxMinor: 20000,
    insuranceMinor: 2000,
    storeStripeAccountId: "acct_store",
    rows,
    disputes: [],
    customRequestIds: new Set(),
    extensionPaymentIds: new Set(),
    legacyFees: [],
    ...overrides,
  });
}

const charge = (id: string, overrides: Partial<PaymentRow> = {}) =>
  row({ id, stripePaymentIntentId: `pi_${id}`, stripeChargeId: `ch_${id}`, ...overrides });
const stripeRefund = (id: string, overrides: Partial<PaymentRow> = {}) =>
  row({ id, stripeRefundId: `re_${id}`, amount: "30.00", ...overrides });

describe("refunds", () => {
  test("a Stripe refund row is folded onto its charge, and the netted charge gets its gross back", () => {
    const [payment, ...rest] = build([
      charge("p1", { amount: "70.00" }),
      stripeRefund("rf1", { refundOfPaymentId: "p1", paidAt: LATER }),
    ]);
    assert.equal(rest.length, 0, "the refund row is not a payment");
    assert.equal(payment?.grossMinor, 10000);
    assert.equal(payment?.currency, "EUR");
    assert.deepEqual(payment?.refunds, [
      {
        refundId: "re_rf1",
        amountMinor: 3000,
        refundedAt: "2026-11-05T08:00:00.000Z",
        via: "stripe",
        stripeRefundId: "re_rf1",
      },
    ]);
  });

  test("a stored gross wins over the approximation", () => {
    const [payment] = build([
      charge("p1", { amount: "70.00", grossMinor: 12000 }),
      stripeRefund("rf1", { refundOfPaymentId: "p1" }),
    ]);
    assert.equal(payment?.grossMinor, 12000);
  });

  test("an unlinked Stripe refund row joins the only charge with its charge id", () => {
    const linked = build([
      charge("p1", { amount: "70.00" }),
      stripeRefund("rf1", { stripeChargeId: "ch_p1" }),
    ]);
    assert.equal(linked[0]?.refunds.length, 1);

    const ambiguous = build([
      charge("p1", { stripeChargeId: "ch_same" }),
      charge("p2", { stripeChargeId: "ch_same" }),
      stripeRefund("rf1", { stripeChargeId: "ch_same" }),
    ]);
    assert.deepEqual(
      ambiguous.map((payment) => payment.refunds.length),
      [0, 0],
    );
  });

  test("an original stamped with a refund id gives gross − net once the gross is known", () => {
    const stamped = charge("p1", {
      amount: "60.00",
      stripeRefundId: "re_old",
      grossMinor: 10000,
      updatedAt: LATER,
    });
    assert.deepEqual(build([stamped])[0]?.refunds, [
      {
        refundId: "re_old",
        amountMinor: 4000,
        refundedAt: "2026-11-05T08:00:00.000Z",
        via: "stripe",
        stripeRefundId: "re_old",
      },
    ]);
    assert.deepEqual(build([{ ...stamped, grossMinor: null }])[0]?.refunds, []);
    // The same refund also stored as a row: sent once, with the row's amount.
    const both = build([
      stamped,
      stripeRefund("rf1", { stripeRefundId: "re_old", refundOfPaymentId: "p1", amount: "40.00" }),
    ]);
    assert.deepEqual(
      both[0]?.refunds.map((refund) => [refund.refundId, refund.amountMinor]),
      [["re_old", 4000]],
    );
  });

  test("a manual refund keeps its row id and the reservation currency", () => {
    const [payment] = build([
      row({ id: "m1", method: "cash", currency: "EUR", amount: "50.00" }),
      row({ id: "m1r", method: "cash", amount: "20.00", refundOfPaymentId: "m1", paidAt: LATER }),
    ]);
    assert.equal(payment?.currency, "USD");
    assert.equal(payment?.grossMinor, 5000, "a manual payment is never netted");
    assert.equal(payment?.stripe, null);
    assert.deepEqual(payment?.refunds, [
      {
        refundId: "m1r",
        amountMinor: 2000,
        refundedAt: "2026-11-05T08:00:00.000Z",
        via: "manual",
        stripeRefundId: null,
      },
    ]);
  });

  test("a refund row that did not complete moved no money", () => {
    const [payment] = build([
      row({ id: "m1", method: "cash" }),
      row({ id: "m1r", method: "cash", status: "pending", refundOfPaymentId: "m1" }),
    ]);
    assert.deepEqual(payment?.refunds, []);
  });
});

describe("kinds and shares", () => {
  test("extensions and custom requests are told apart from rentals", () => {
    const payments = build(
      [
        charge("ext", { origin: "extension" }),
        charge("old_ext"),
        charge("req", { origin: "payment_request", paymentRequestId: "pr_custom" }),
        charge("rent_req", { origin: "payment_request", paymentRequestId: "pr_rental" }),
        row({ id: "hold", type: "deposit_hold", status: "authorized" }),
        row({ id: "adj", type: "adjustment", method: "cash", amount: "-5.00" }),
      ],
      { extensionPaymentIds: new Set(["old_ext"]), customRequestIds: new Set(["pr_custom"]) },
    );
    assert.deepEqual(
      payments.map((payment) => [payment.paymentId, payment.kind]),
      [
        ["ext", "extension"],
        ["old_ext", "extension"],
        ["req", "custom_request"],
        ["rent_req", "rental"],
        ["hold", "deposit_hold"],
        ["adj", "adjustment"],
      ],
    );
    assert.equal(payments[5]?.grossMinor, -500, "adjustments are signed");
  });

  test("the insurance share is the stored one, else computed now, and 0 for other kinds", () => {
    const payments = build(
      [
        charge("stored", { insuranceShareMinor: 123 }),
        charge("computed"),
        charge("custom", { paymentRequestId: "pr" }),
        row({ id: "deposit", type: "deposit", method: "cash" }),
      ],
      { customRequestIds: new Set(["pr"]) },
    );
    // insuranceShare(2000, 10000, 20000) = 1000 (fees.md §4).
    assert.deepEqual(
      payments.map((payment) => payment.insuranceShareMinor),
      [123, 1000, 0, 0],
    );
  });

  test("a pending payment of 0 is sent as stored", () => {
    const [payment] = build([
      row({
        id: "p0",
        amount: "0.00",
        status: "pending",
        paidAt: null,
        stripeCheckoutSessionId: "cs_1",
      }),
    ]);
    assert.equal(payment?.status, "pending");
    assert.equal(payment?.grossMinor, 0);
    assert.equal(payment?.paidAt, null);
    assert.deepEqual(payment?.stripe, {
      accountId: "acct_store",
      paymentIntentId: null,
      chargeId: null,
      checkoutSessionId: "cs_1",
    });
  });
});

describe("app fee", () => {
  test("the copied metadata, with the policy only for store and default scopes", () => {
    const fee = {
      appFeeTotalMinor: 500,
      appFeeReservationMinor: 400,
      appFeeMarketplaceMinor: 100,
      appFeeBaseMinor: 9000,
      appFeeMetadataVersion: 4,
    };
    const [store, legacy] = build([
      charge("p1", { ...fee, appFeePolicyScope: "store", appFeePolicyVersion: 7 }),
      charge("p2", { ...fee, appFeePolicyScope: "legacy", appFeePolicyVersion: 0 }),
    ]);
    assert.deepEqual(store?.appFee, {
      totalMinor: 500,
      reservationMinor: 400,
      marketplaceMinor: 100,
      baseMinor: 9000,
      policy: { scope: "store", version: 7 },
      metadataVersion: 4,
    });
    assert.equal(legacy?.appFee?.policy, null);
  });

  /** A legacy fee taken at source on `pi_p1`, as the webhook records it. */
  const legacyFee = (
    prefix: "res" | "mkt",
    amountCents: number,
    overrides: Partial<LegacyFeeRow> = {},
  ): LegacyFeeRow => ({
    dedupKey: `${prefix}:r1`,
    amountCents,
    stripePaymentIntentId: "pi_p1",
    source: prefix === "res" ? "online" : "marketplace_online",
    status: "collected",
    ...overrides,
  });
  const legacyAppFee = (reservationMinor: number, marketplaceMinor: number) => ({
    totalMinor: reservationMinor + marketplaceMinor,
    reservationMinor,
    marketplaceMinor,
    baseMinor: 0,
    policy: null,
    metadataVersion: 3,
  });

  test("older Stripe payments fall back to the legacy rows of their PaymentIntent", () => {
    const [matched, other] = build([charge("p1"), charge("p2")], {
      legacyFees: [legacyFee("res", 90), legacyFee("mkt", 150)],
    });
    assert.deepEqual(matched?.appFee, legacyAppFee(90, 150));
    assert.equal(other?.appFee, null);
  });

  test("the fallback counts only the legacy rows Stripe took on the charge", () => {
    // The reservation fee did not fit the charge: billed at month end, PaymentIntent kept.
    const [unfit] = build([charge("p1")], {
      legacyFees: [
        legacyFee("res", 300, { source: "manual", status: "pending" }),
        legacyFee("mkt", 100),
      ],
    });
    assert.deepEqual(unfit?.appFee, legacyAppFee(0, 100));

    const [nothingTaken] = build([charge("p1")], {
      legacyFees: [
        legacyFee("res", 300, { source: "manual", status: "voided" }),
        legacyFee("mkt", 100, { source: "marketplace_manual", status: "pending" }),
      ],
    });
    assert.equal(nothingTaken?.appFee, null);

    // A fee reversed after a refund was still asked at source; a voided one never was.
    const [reversed] = build([charge("p1")], {
      legacyFees: [
        legacyFee("res", 90, { status: "reversed" }),
        legacyFee("mkt", 100, { status: "voided" }),
      ],
    });
    assert.deepEqual(reversed?.appFee, legacyAppFee(90, 0));
  });

  test("a half-written fee is refused, not guessed", () => {
    assert.throws(
      () => build([charge("p1", { appFeeMetadataVersion: 4, appFeeTotalMinor: 1 })]),
      SnapshotDataError,
    );
  });
});

describe("disputes and limits", () => {
  const dispute = (id: string, overrides: Partial<DisputeRow> = {}): DisputeRow => ({
    id,
    paymentId: "p1",
    amountMinor: 10000,
    status: "open",
    openedAt: AT,
    closedAt: null,
    ...overrides,
  });

  test("disputes whose funds were withdrawn are mapped as stored", () => {
    const [payment] = build([charge("p1")], {
      disputes: [
        dispute("du_1", { status: "lost", closedAt: LATER }),
        dispute("du_zero", { amountMinor: 0 }),
        dispute("du_other", { paymentId: "p_other" }),
      ],
    });
    assert.deepEqual(payment?.disputes, [
      {
        disputeId: "du_1",
        amountMinor: 10000,
        status: "lost",
        openedAt: "2026-11-03T10:15:00.000Z",
        closedAt: "2026-11-05T08:00:00.000Z",
      },
    ]);
  });

  test("a list over its limit throws, naming the reservation", () => {
    const many = (count: number, make: (index: number) => PaymentRow) =>
      Array.from({ length: count }, (_, index) => make(index));
    const isLimitError = (pattern: RegExp) => (error: unknown) =>
      error instanceof SnapshotDataError && pattern.test(error.message);

    assert.equal(build(many(200, (i) => row({ id: `p${i}` }))).length, 200);
    assert.throws(
      () => build(many(201, (i) => row({ id: `p${i}` }))),
      isLimitError(/^reservation r1: payments has 201 entries/),
    );
    assert.throws(
      () =>
        build([
          row({ id: "m1", method: "cash" }),
          ...many(101, (i) =>
            row({ id: `r${i}`, method: "cash", amount: "0.01", refundOfPaymentId: "m1" }),
          ),
        ]),
      isLimitError(/^reservation r1: payment m1 refunds has 101 entries/),
    );
    assert.throws(
      () =>
        build([charge("p1")], {
          disputes: Array.from({ length: 21 }, (_, i) => dispute(`du_${i}`)),
        }),
      isLimitError(/^reservation r1: payment p1 disputes has 21 entries/),
    );
  });
});
