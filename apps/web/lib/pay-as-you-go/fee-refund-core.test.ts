import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { splitFeeRefund } from "./fee-refund-core";

const shares = (rows: Array<{ id: string; amountCents: number }>, refundedMinor: number) =>
  splitFeeRefund(rows, refundedMinor).map(({ row, amountReversedCents, fullyReversed }) => ({
    id: row.id,
    amountReversedCents,
    fullyReversed,
  }));

describe("splitFeeRefund", () => {
  test("one row takes the whole refund", () => {
    assert.deepEqual(shares([{ id: "res", amountCents: 375 }], 125), [
      { id: "res", amountReversedCents: 125, fullyReversed: false },
    ]);
  });

  test("two rows share in proportion, half up, the last taking the rest", () => {
    // 3 × 300 / 450 = 2: the first row gets 2, the second the rest, 1.
    assert.deepEqual(
      shares(
        [
          { id: "res", amountCents: 300 },
          { id: "mkt", amountCents: 150 },
        ],
        3,
      ),
      [
        { id: "res", amountReversedCents: 2, fullyReversed: false },
        { id: "mkt", amountReversedCents: 1, fullyReversed: false },
      ],
    );
    // 1 × 150 / 450 = 0.33: the first gets 0, the last the 1.
    assert.deepEqual(
      shares(
        [
          { id: "mkt", amountCents: 150 },
          { id: "res", amountCents: 300 },
        ],
        1,
      ),
      [
        { id: "mkt", amountReversedCents: 0, fullyReversed: false },
        { id: "res", amountReversedCents: 1, fullyReversed: false },
      ],
    );
  });

  test("a full refund reverses every row", () => {
    assert.deepEqual(
      shares(
        [
          { id: "res", amountCents: 300 },
          { id: "mkt", amountCents: 150 },
        ],
        450,
      ),
      [
        { id: "res", amountReversedCents: 300, fullyReversed: true },
        { id: "mkt", amountReversedCents: 150, fullyReversed: true },
      ],
    );
  });

  test("a refund above the rows is capped at their amounts", () => {
    // The fee held a part Louez recorded as 0 (a free entry, README Q21).
    assert.deepEqual(shares([{ id: "mkt", amountCents: 150 }], 450), [
      { id: "mkt", amountReversedCents: 150, fullyReversed: true },
    ]);
  });

  test("no rows, or rows of 0, reverse nothing", () => {
    assert.deepEqual(shares([], 100), []);
    assert.deepEqual(shares([{ id: "res", amountCents: 0 }], 100), [
      { id: "res", amountReversedCents: 0, fullyReversed: false },
    ]);
  });
});
