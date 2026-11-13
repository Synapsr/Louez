import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type FailedAttemptRefusal,
  failedAttemptBinding,
  failedAttemptReservationId,
} from "./failed-attempt-binding";

// The binding of a rental payment's `payment_intent.payment_failed`: the deployment's
// mode, the account that sent it, the reservation of the rows that record its
// PaymentIntent or the one it names, in that account's store.

const RESERVATION = "res_bound_00000000001";
const OTHER = "res_other_00000000001";
const ACCOUNT = "acct_store";

const reservation = (id = RESERVATION, stripeAccountId: string | null = ACCOUNT) => ({
  id,
  store: { stripeAccountId },
});

type Input = Parameters<typeof failedAttemptBinding<ReturnType<typeof reservation>>>[0];

const bound: Input = {
  livemode: false,
  secretKey: "sk_test_123",
  accountId: ACCOUNT,
  namedReservationId: RESERVATION,
  recordedReservationIds: [],
  reservation: reservation(),
};

describe("failedAttemptBinding", () => {
  test("an event that agrees with its records is bound to its reservation", () => {
    const cases: ReadonlyArray<readonly [string, Partial<Input>]> = [
      ["named, no row", {}],
      ["a row of the reservation, named", { recordedReservationIds: [RESERVATION] }],
      [
        "a row of the reservation, not named",
        { recordedReservationIds: [RESERVATION], namedReservationId: undefined },
      ],
      ["two rows of the reservation", { recordedReservationIds: [RESERVATION, RESERVATION] }],
      ["live, under a live key", { livemode: true, secretKey: "sk_live_123" }],
    ];
    for (const [name, overrides] of cases) {
      const binding = failedAttemptBinding({ ...bound, ...overrides });
      assert.deepEqual(binding, { ok: true, reservation: reservation() }, name);
    }
  });

  test("an event that disagrees is refused, in the table's order", () => {
    const cases: ReadonlyArray<readonly [Partial<Input>, FailedAttemptRefusal]> = [
      [{ livemode: true }, "livemode_mismatch"],
      [{ secretKey: "sk_live_123" }, "livemode_mismatch"],
      [{ secretKey: undefined }, "livemode_mismatch"],
      [{ livemode: true, accountId: undefined }, "livemode_mismatch"],
      [{ accountId: undefined }, "connected_account_missing"],
      [{ accountId: "" }, "connected_account_missing"],
      [{ namedReservationId: undefined, reservation: null }, "invalid_reservation_id"],
      [{ namedReservationId: "res_short", reservation: null }, "invalid_reservation_id"],
      [{ reservation: null }, "reservation_not_found"],
      [
        {
          recordedReservationIds: [RESERVATION],
          namedReservationId: "res_short",
          reservation: null,
        },
        "reservation_not_found",
      ],
      [{ accountId: "acct_other" }, "connected_account_mismatch"],
      [{ reservation: reservation(RESERVATION, null) }, "connected_account_mismatch"],
      [
        { accountId: "acct_other", recordedReservationIds: [RESERVATION, OTHER] },
        "connected_account_mismatch",
      ],
      [
        { recordedReservationIds: [RESERVATION], namedReservationId: OTHER },
        "reservation_mismatch",
      ],
      [
        { recordedReservationIds: [RESERVATION], namedReservationId: "res_short" },
        "reservation_mismatch",
      ],
      [
        { recordedReservationIds: [RESERVATION, OTHER], namedReservationId: undefined },
        "reservation_mismatch",
      ],
      [{ namedReservationId: OTHER }, "reservation_mismatch"],
    ];
    for (const [overrides, issue] of cases) {
      assert.deepEqual(
        failedAttemptBinding({ ...bound, ...overrides }),
        { ok: false, issue },
        JSON.stringify(overrides),
      );
    }
  });
});

describe("failedAttemptReservationId", () => {
  test("the rows' reservation when a row records the PaymentIntent, else the one the event names", () => {
    const cases: ReadonlyArray<
      readonly [recorded: readonly string[], named: string | undefined, read: string | undefined]
    > = [
      [[], RESERVATION, RESERVATION],
      [[], undefined, undefined],
      [[RESERVATION], OTHER, RESERVATION],
      [[RESERVATION], undefined, RESERVATION],
      [[RESERVATION, OTHER], undefined, RESERVATION],
    ];
    for (const [recordedReservationIds, namedReservationId, read] of cases) {
      assert.equal(
        failedAttemptReservationId({ recordedReservationIds, namedReservationId }),
        read,
      );
    }
  });
});
