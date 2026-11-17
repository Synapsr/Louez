import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type DepositIntent,
  type HoldRow,
  type HoldRowState,
  type HoldWrites,
  type IntentState,
  type ReservationRelation,
  absentAttemptTransition,
  bindDepositIntent,
  depositHoldTransition,
  holdRowStateOf,
  holdsNameIntentOnAccount,
  intentStateOf,
  reservationRelationOf,
} from "./util.deposit-hold-transition";

// Every pair of a hold row's state and a PaymentIntent's state at the provider, for
// each thing the reservation may reference: what is written is stated here cell by
// cell, apart from the code that decides it.

const ROWS: readonly HoldRowState[] = [
  "none",
  "pending",
  "failed",
  "authorized",
  "release_owed",
  "completed",
  "cancelled",
];
const INTENTS: readonly IntentState[] = ["unconfirmed", "processing", "held", "canceled", "captured"];
const RELATIONS: readonly ReservationRelation[] = ["this_live", "this_done", "other_live", "free"];

/** `row | reservation | capture, activity, release | outcome`, `-` for nothing. */
const show = (writes: HoldWrites) =>
  [
    writes.row === null
      ? "-"
      : writes.row === "close"
        ? "close"
        : `${writes.row.status}${writes.row.releaseOwed ? "+owed" : ""}`,
    writes.reservation ?? "-",
    [
      writes.capture ? "capture" : "",
      writes.activity ?? "",
      writes.owesRelease ? "release" : "",
    ]
      .filter(Boolean)
      .join(",") || "-",
    writes.outcome,
  ].join(" | ");

const STALE = "- | - | - | stale";
const all = (cell: string) => [cell, cell, cell, cell] as const;

// The four cells of a row are the reservation's relation to the PaymentIntent, in the
// order of RELATIONS: it references it as its hold, it references it and it is over,
// it holds another, it holds none.
type Cells = readonly [string, string, string, string];

/** The provider holds the funds. */
const HELD_UNRECORDED: Cells = [
  "authorized | - | - | authorized",
  STALE,
  "authorized+owed | - | release | superseded",
  "authorized | authorized | deposit_authorized | authorized",
];
/** The provider cancelled it. */
const CANCELED_OPEN: Cells = [
  "cancelled | released | deposit_released | released",
  "cancelled | - | - | released",
  "cancelled | - | - | released",
  "cancelled | - | - | released",
];
/** The provider captured it. */
const CAPTURED_OPEN: Cells = [
  "completed | captured | capture,deposit_captured | captured",
  "completed | captured | capture,deposit_captured | captured",
  "completed | - | capture,deposit_captured | captured",
  "completed | captured | capture,deposit_captured | captured",
];

const TABLE: Record<IntentState, Record<HoldRowState, Cells>> = {
  held: {
    none: HELD_UNRECORDED,
    pending: HELD_UNRECORDED,
    // A closed attempt whose PaymentIntent shows up held: the hold when the
    // reservation has none, a release owed when it has another.
    failed: HELD_UNRECORDED,
    authorized: [
      "- | - | - | authorized",
      STALE,
      "authorized+owed | - | release | superseded",
      "- | authorized | deposit_authorized | authorized",
    ],
    // Decided against once: never adopted, and its release is asked for once.
    release_owed: all("- | - | - | superseded"),
    completed: all(STALE),
    cancelled: all(STALE),
  },
  canceled: {
    none: CANCELED_OPEN,
    pending: CANCELED_OPEN,
    failed: CANCELED_OPEN,
    authorized: CANCELED_OPEN,
    release_owed: CANCELED_OPEN,
    completed: all(STALE),
    cancelled: [
      "- | released | deposit_released | released",
      "- | - | - | released",
      "- | - | - | released",
      "- | - | - | released",
    ],
  },
  captured: {
    none: CAPTURED_OPEN,
    pending: CAPTURED_OPEN,
    failed: CAPTURED_OPEN,
    authorized: CAPTURED_OPEN,
    release_owed: CAPTURED_OPEN,
    completed: [
      "- | captured | capture,deposit_captured | captured",
      "- | captured | capture,deposit_captured | captured",
      "- | - | capture,deposit_captured | captured",
      // Recorded before, apart from the reservation: it stays apart.
      "- | - | capture,deposit_captured | captured",
    ],
    cancelled: all(STALE),
  },
  unconfirmed: {
    none: ["- | - | - | failed", "- | - | - | failed", "- | - | - | failed", "- | failed | - | failed"],
    pending: [
      "failed | - | deposit_failed | failed",
      "failed | - | deposit_failed | failed",
      "failed | - | deposit_failed | failed",
      "failed | failed | deposit_failed | failed",
    ],
    failed: all("- | - | - | failed"),
    authorized: all(STALE),
    release_owed: all(STALE),
    completed: all(STALE),
    cancelled: all(STALE),
  },
  processing: {
    none: all("- | - | - | pending"),
    pending: all("pending | - | - | pending"),
    failed: all("- | - | - | pending"),
    authorized: all(STALE),
    release_owed: all(STALE),
    completed: all(STALE),
    cancelled: all(STALE),
  },
};

/** How far a row is: it never moves to a lower rank, and the last rank is final. */
const RANK: Record<HoldRowState, number> = {
  none: 0,
  pending: 1,
  failed: 2,
  authorized: 3,
  release_owed: 3,
  completed: 4,
  cancelled: 4,
};

describe("depositHoldTransition", () => {
  for (const intent of INTENTS) {
    for (const row of ROWS) {
      test(`a ${row} row, a PaymentIntent ${intent}`, () => {
        assert.deepEqual(
          RELATIONS.map((relation) => show(depositHoldTransition(row, intent, relation))),
          [...TABLE[intent][row]],
        );
      });
    }
  }

  test("the table states every pair", () => {
    assert.deepEqual(Object.keys(TABLE).sort(), [...INTENTS].sort());
    for (const intent of INTENTS) {
      assert.deepEqual(Object.keys(TABLE[intent]).sort(), [...ROWS].sort());
    }
  });

  test("whatever the pair: no row moves backward, a final row is never rewritten, a hold is never taken from another", () => {
    for (const intent of INTENTS) {
      for (const row of ROWS) {
        for (const relation of RELATIONS) {
          const writes = depositHoldTransition(row, intent, relation);
          const cell = `${row} / ${intent} / ${relation}`;
          // Only a lookup that found nothing closes an attempt.
          assert.notEqual(writes.row, "close", cell);
          if (writes.row && writes.row !== "close") {
            const next = writes.row.releaseOwed ? "release_owed" : writes.row.status;
            assert.ok(RANK[next] >= RANK[row], `${cell} moves the row backward`);
            assert.ok(RANK[row] < 4, `${cell} rewrites a final row`);
            // A release is owed only for an authorization the provider holds.
            assert.equal(writes.row.releaseOwed && writes.row.status !== "authorized", false, cell);
          }
          // The reservation that holds another PaymentIntent keeps it.
          if (relation === "other_live") assert.equal(writes.reservation, null, cell);
          // A debt is recorded with the row that says so, once.
          if (writes.owesRelease) {
            assert.deepEqual(writes.row, { status: "authorized", releaseOwed: true }, cell);
            assert.notEqual(row, "release_owed", cell);
            assert.equal(relation, "other_live", cell);
          }
          // Money is recorded whenever the provider captured, unless the row says it
          // was cancelled, which the provider never captures.
          if (intent === "captured" && row !== "cancelled") assert.equal(writes.capture, true, cell);
          if (intent !== "captured") assert.equal(writes.capture, false, cell);
          // Only an authorization the provider holds becomes the reservation's hold.
          if (writes.reservation === "authorized") assert.equal(intent, "held", cell);
          if (writes.outcome === "stale") {
            assert.deepEqual(
              [writes.row, writes.reservation, writes.capture, writes.activity, writes.owesRelease],
              [null, null, false, null, false],
              cell,
            );
          }
        }
      }
    }
  });
});

describe("absentAttemptTransition", () => {
  test("an attempt no PaymentIntent was found for is closed, and keeps its row", () => {
    assert.equal(
      show(absentAttemptTransition({ refused: false, reservationHolds: false })),
      "close | - | - | failed",
    );
  });

  test("a refusal fails the deposit, unless the reservation holds one", () => {
    assert.equal(
      show(absentAttemptTransition({ refused: true, reservationHolds: false })),
      "close | failed | deposit_failed | failed",
    );
    assert.equal(
      show(absentAttemptTransition({ refused: true, reservationHolds: true })),
      "close | - | deposit_failed | failed",
    );
  });
});

describe("a closed attempt, against every state the provider may give its PaymentIntent", () => {
  // A `failed` row is closed for new requests, never for the provider: whatever it
  // made of the attempt is settled from there, the reservation deciding whether a
  // late authorization is its hold or a release owed.
  const CLOSED: Record<IntentState, Cells> = {
    unconfirmed: all("- | - | - | failed"),
    processing: all("- | - | - | pending"),
    held: [
      "authorized | - | - | authorized",
      STALE,
      "authorized+owed | - | release | superseded",
      "authorized | authorized | deposit_authorized | authorized",
    ],
    canceled: [
      "cancelled | released | deposit_released | released",
      "cancelled | - | - | released",
      "cancelled | - | - | released",
      "cancelled | - | - | released",
    ],
    captured: [
      "completed | captured | capture,deposit_captured | captured",
      "completed | captured | capture,deposit_captured | captured",
      "completed | - | capture,deposit_captured | captured",
      "completed | captured | capture,deposit_captured | captured",
    ],
  };

  for (const intent of INTENTS) {
    test(`its PaymentIntent ${intent}`, () => {
      assert.deepEqual(
        RELATIONS.map((relation) => show(depositHoldTransition("failed", intent, relation))),
        [...CLOSED[intent]],
      );
    });
  }

  test("no provider state leaves a held or captured PaymentIntent unrecorded", () => {
    for (const intent of ["held", "captured"] as const) {
      for (const relation of RELATIONS) {
        const writes = depositHoldTransition("failed", intent, relation);
        if (relation === "this_done" && intent === "held") continue;
        assert.ok(writes.row && writes.row !== "close", `${intent} / ${relation}`);
      }
    }
  });
});

describe("the states read from the rows and from the provider", () => {
  test("a provider status", () => {
    assert.equal(intentStateOf("requires_capture"), "held");
    assert.equal(intentStateOf("canceled"), "canceled");
    assert.equal(intentStateOf("succeeded"), "captured");
    for (const status of ["requires_payment_method", "requires_confirmation", "requires_action"]) {
      assert.equal(intentStateOf(status), "unconfirmed");
    }
    assert.equal(intentStateOf("processing"), "processing");
    // A status this code does not know decides nothing.
    assert.equal(intentStateOf("requires_something_new"), "processing");
  });

  test("a hold row", () => {
    const row = (status: string, releaseOwed = false): HoldRow => ({
      id: "attempt",
      status,
      paymentIntentId: "pi",
      accountId: "acct",
      releaseOwed,
      amountMinor: 5000,
      currency: "EUR",
      paymentMethodId: "pm",
    });
    assert.equal(holdRowStateOf(null), "none");
    assert.equal(holdRowStateOf(row("pending")), "pending");
    assert.equal(holdRowStateOf(row("failed")), "failed");
    assert.equal(holdRowStateOf(row("authorized")), "authorized");
    assert.equal(holdRowStateOf(row("authorized", true)), "release_owed");
    assert.equal(holdRowStateOf(row("completed")), "completed");
    assert.equal(holdRowStateOf(row("cancelled")), "cancelled");
    // A status no hold is written with is final: nothing adopts it.
    assert.equal(holdRowStateOf(row("refunded")), "cancelled");
  });

  test("what the reservation references", () => {
    const relation = (depositStatus: string | null, depositPaymentIntentId: string | null) =>
      reservationRelationOf({ depositStatus, depositPaymentIntentId }, "pi_this");
    assert.equal(relation("authorized", "pi_this"), "this_live");
    assert.equal(relation("captured", "pi_this"), "this_done");
    assert.equal(relation("released", "pi_this"), "this_done");
    assert.equal(relation("authorized", "pi_other"), "other_live");
    assert.equal(relation("captured", "pi_other"), "other_live");
    assert.equal(relation("released", "pi_other"), "free");
    assert.equal(relation("failed", "pi_other"), "free");
    assert.equal(relation("card_saved", null), "free");
    assert.equal(relation(null, null), "free");
  });
});

describe("bindDepositIntent", () => {
  const RESERVATION = "reservation_aaaaaaaaaa";
  const ACCOUNT = "acct_now";
  const OLD_ACCOUNT = "acct_before";

  const intentOf = (values: Partial<DepositIntent> = {}): DepositIntent => ({
    paymentIntentId: "pi_new",
    status: "requires_capture",
    amountMinor: 5000,
    capturedMinor: 0,
    currency: "EUR",
    captureBefore: null,
    captureMethod: "manual",
    customerId: "cus_1",
    paymentMethodId: "pm_card",
    chargeId: null,
    attemptId: null,
    reservationId: RESERVATION,
    ...values,
  });
  const rowOf = (values: Partial<HoldRow> = {}): HoldRow => ({
    id: "attempt_1",
    status: "pending",
    paymentIntentId: null,
    accountId: ACCOUNT,
    releaseOwed: false,
    amountMinor: 5000,
    currency: "EUR",
    paymentMethodId: "pm_card",
    ...values,
  });
  const bind = (
    holds: readonly HoldRow[],
    intent: DepositIntent,
    account: { id?: string; current?: boolean } = {},
  ) =>
    bindDepositIntent({
      reservationId: RESERVATION,
      holds,
      intent,
      accountId: account.id ?? ACCOUNT,
      currentAccount: account.current ?? true,
    });

  test("a PaymentIntent of another reservation is written on none", () => {
    assert.deepEqual(bind([], intentOf({ reservationId: "reservation_bbbbbbbbbb" })), {
      ok: false,
      reason: "other_reservation",
    });
    assert.deepEqual(bind([], intentOf({ reservationId: null })), {
      ok: false,
      reason: "other_reservation",
    });
    // Also when a row of this reservation names it.
    const own = rowOf({ status: "authorized", paymentIntentId: "pi_new" });
    assert.deepEqual(bind([own], intentOf({ reservationId: "reservation_bbbbbbbbbb" })), {
      ok: false,
      reason: "other_reservation",
    });
  });

  test("a PaymentIntent that is charged at once is not a hold", () => {
    assert.deepEqual(bind([], intentOf({ captureMethod: "automatic" })), {
      ok: false,
      reason: "not_a_hold",
    });
  });

  test("the row that names the PaymentIntent is its row, on the account the row names", () => {
    const own = rowOf({ status: "authorized", paymentIntentId: "pi_new" });
    assert.deepEqual(bind([own], intentOf()), { ok: true, row: own });
    // The store left that account: its events are still the row's.
    const left = rowOf({ status: "authorized", paymentIntentId: "pi_new", accountId: OLD_ACCOUNT });
    assert.deepEqual(bind([left], intentOf(), { id: OLD_ACCOUNT, current: false }), {
      ok: true,
      row: left,
    });
    // A row older than the account column is believed on the account that sent it.
    const legacy = rowOf({ status: "authorized", paymentIntentId: "pi_new", accountId: null });
    assert.deepEqual(bind([legacy], intentOf()), { ok: true, row: legacy });
  });

  test("a PaymentIntent on another account than its row's is written on none", () => {
    const own = rowOf({ status: "authorized", paymentIntentId: "pi_new", accountId: OLD_ACCOUNT });
    assert.deepEqual(bind([own], intentOf()), { ok: false, reason: "other_account" });
    const attempt = rowOf({ accountId: OLD_ACCOUNT });
    assert.deepEqual(bind([attempt], intentOf({ attemptId: "attempt_1" })), {
      ok: false,
      reason: "other_account",
    });
  });

  test("a pending attempt with no PaymentIntent yet takes the one it was sent for", () => {
    const attempt = rowOf();
    assert.deepEqual(bind([attempt], intentOf({ attemptId: "attempt_1" })), {
      ok: true,
      row: attempt,
    });
    // Also on an account the store left since: the attempt was sent there.
    const left = rowOf({ accountId: OLD_ACCOUNT });
    assert.deepEqual(
      bind([left], intentOf({ attemptId: "attempt_1" }), { id: OLD_ACCOUNT, current: false }),
      { ok: true, row: left },
    );
  });

  test("a closed attempt with no PaymentIntent still takes the one it was sent for, on its account", () => {
    const closed = rowOf({ status: "failed" });
    assert.deepEqual(bind([closed], intentOf({ attemptId: "attempt_1" })), {
      ok: true,
      row: closed,
    });
    const left = rowOf({ status: "failed", accountId: OLD_ACCOUNT });
    assert.deepEqual(
      bind([left], intentOf({ attemptId: "attempt_1" }), { id: OLD_ACCOUNT, current: false }),
      { ok: true, row: left },
    );
    // Its facts still decide.
    assert.deepEqual(bind([closed], intentOf({ attemptId: "attempt_1", amountMinor: 1 })), {
      ok: false,
      reason: "facts_mismatch",
    });
    // A refusal that named its PaymentIntent is that PaymentIntent's row only.
    const declined = rowOf({ status: "failed", paymentIntentId: "pi_declined" });
    assert.deepEqual(bind([declined], intentOf({ attemptId: "attempt_1" })), {
      ok: false,
      reason: "attempt_bound",
    });
  });

  test("an attempt that has its PaymentIntent takes no other, from any account", () => {
    const bound = rowOf({ status: "authorized", paymentIntentId: "pi_first" });
    const second = intentOf({ paymentIntentId: "pi_second", attemptId: "attempt_1" });
    assert.deepEqual(bind([bound], second), { ok: false, reason: "attempt_bound" });
    const left = rowOf({ status: "cancelled", paymentIntentId: "pi_first", accountId: OLD_ACCOUNT });
    assert.deepEqual(bind([left], second, { id: OLD_ACCOUNT, current: false }), {
      ok: false,
      reason: "attempt_bound",
    });
  });

  test("a PaymentIntent that is not what the attempt was sent with is written on none", () => {
    const attempt = rowOf();
    const mismatches: Array<Partial<DepositIntent>> = [
      { amountMinor: 9000 },
      { currency: "USD" },
      { paymentMethodId: "pm_other" },
      { paymentMethodId: null },
      { customerId: null },
    ];
    for (const mismatch of mismatches) {
      assert.deepEqual(
        bind([attempt], intentOf({ attemptId: "attempt_1", ...mismatch })),
        { ok: false, reason: "facts_mismatch" },
        JSON.stringify(mismatch),
      );
    }
    // The currency's case is not a difference.
    assert.equal(bind([rowOf({ currency: "eur" })], intentOf({ attemptId: "attempt_1" })).ok, true);
  });

  test("a PaymentIntent no row names is the customer's own, on the store's account only", () => {
    assert.deepEqual(bind([], intentOf()), { ok: true, row: null });
    assert.deepEqual(bind([], intentOf(), { id: OLD_ACCOUNT, current: false }), {
      ok: false,
      reason: "unknown_on_account",
    });
    // Naming an attempt Louez does not have gives an account the store left no say.
    assert.deepEqual(
      bind([], intentOf({ attemptId: "attempt_gone" }), { id: OLD_ACCOUNT, current: false }),
      { ok: false, reason: "unknown_on_account" },
    );
    assert.deepEqual(bind([], intentOf({ attemptId: "attempt_gone" })), { ok: true, row: null });
  });

  test("an account has a say only about the rows that name it", () => {
    const bound = rowOf({ status: "authorized", paymentIntentId: "pi_held", accountId: OLD_ACCOUNT });
    const attempt = rowOf({ id: "attempt_2", accountId: OLD_ACCOUNT });
    const claim = (paymentIntentId: string, attemptId: string | null, accountId = OLD_ACCOUNT) =>
      holdsNameIntentOnAccount([bound, attempt], { accountId, paymentIntentId, attemptId });

    assert.equal(claim("pi_held", null), true);
    assert.equal(claim("pi_new", "attempt_2"), true);
    // The attempt of the bound row is no way in for another PaymentIntent.
    assert.equal(claim("pi_new", "attempt_1"), false);
    assert.equal(claim("pi_new", null), false);
    assert.equal(claim("pi_held", null, "acct_third"), false);
    assert.equal(claim("pi_new", "attempt_2", "acct_third"), false);
    // A closed attempt keeps its account's say about the PaymentIntent it was sent for.
    const closed = rowOf({ id: "attempt_3", status: "failed", accountId: OLD_ACCOUNT });
    assert.equal(
      holdsNameIntentOnAccount([closed], {
        accountId: OLD_ACCOUNT,
        paymentIntentId: "pi_late",
        attemptId: "attempt_3",
      }),
      true,
    );
  });
});
