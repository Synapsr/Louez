import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { paidConfirmationKeepsDeposit } from "./util.paid-confirmation-deposit";

// The state table of docs/domain/reservation-changes.md, slice 6a-1, row by row:
// every `depositStatus` the column holds, null included, with and without a
// `deposit_hold` row `authorized` or `completed`.

const HELD = ["authorized", "captured"] as const;
const NOTHING_HELD = [null, "none", "pending", "card_saved"] as const;
const SETTLED = ["released", "failed"] as const;

describe("paidConfirmationKeepsDeposit", () => {
  for (const depositStatus of HELD) {
    for (const ledgerHoldsFunds of [true, false]) {
      test(`${depositStatus}, ${ledgerHoldsFunds ? "a row holding funds" : "no row holding funds"}: kept`, () => {
        assert.equal(paidConfirmationKeepsDeposit({ depositStatus, ledgerHoldsFunds }), true);
      });
    }
  }

  for (const depositStatus of [...NOTHING_HELD, ...SETTLED]) {
    test(`${depositStatus}, a row holding funds: kept`, () => {
      assert.equal(paidConfirmationKeepsDeposit({ depositStatus, ledgerHoldsFunds: true }), true);
    });

    test(`${depositStatus}, no row holding funds: written`, () => {
      assert.equal(paidConfirmationKeepsDeposit({ depositStatus, ledgerHoldsFunds: false }), false);
    });
  }
});
