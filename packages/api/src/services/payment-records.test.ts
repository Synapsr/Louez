import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

// @louez/utils is a CommonJS workspace package: its named exports are not
// statically visible to the ESM loader, so hand them over through require.
const require = createRequire(import.meta.url);
const utils: Record<string, unknown> = require("@louez/utils");

mock.module("@louez/utils", { namedExports: utils });

const {
  depositReturnAmount,
  paymentAmount,
  recordedPaymentAmount,
  refundAmount,
  refusedWhateverTheCurrency,
} = await import("./payment-amount");
const { money, moneyIn } = await import("./payment-records");

// A payment recorded and a deposit return write their amount in the
// reservation's currency (`moneyIn`), where they wrote euros (`money`): a
// euro amount, as the write accepts it, reads byte for byte as it did.
describe("the amount of a payment recorded, as its preview writes it", () => {
  test("in euros, every amount the write accepts reads as it did", () => {
    const amounts = [
      "1",
      "0.01",
      "0.5",
      "007.5",
      "80.00",
      "150",
      "999.99",
      "1000",
      "1234.5",
      "99999999.99",
      "-0.01",
      "-20.5",
      "-1234567.89",
    ];
    for (const raw of amounts) {
      const amount = paymentAmount(raw);
      assert.ok(amount, raw);
      assert.equal(moneyIn(amount, "EUR"), money(raw), raw);
    }
    // And a balance, written with two decimals by the deposit return's refusal.
    for (const balance of [0, 0.5, 30, 1234.56, -5]) {
      assert.equal(moneyIn(balance.toFixed(2), "EUR"), money(balance.toFixed(2)), String(balance));
    }
  });

  test("in another currency, with its own symbol and exactly the digits the row holds", () => {
    assert.equal(moneyIn("1.00", "JPY"), "¥1");
    assert.equal(moneyIn("1500.00", "JPY"), "¥1,500");
    assert.equal(moneyIn("80.00", "CHF"), "CHF 80.00");
    assert.equal(moneyIn("20.50", "GBP"), "£20.50");
  });
});

describe("an amount that is not text", () => {
  test("is refused by the shared parser and every verdict, never read as a number, never a throw", () => {
    const notText: unknown[] = [7, [7], ["7.123"], { amount: "7" }, null, undefined, 7.5, true];
    for (const raw of notText) {
      const label = JSON.stringify(raw) ?? String(raw);
      const value = raw as string;
      assert.equal(paymentAmount(raw), null, label);
      assert.deepEqual(
        recordedPaymentAmount(value, "rental", "EUR"),
        { ok: false, refusal: "amount_invalid" },
        label,
      );
      assert.deepEqual(
        depositReturnAmount(value, "EUR", 10_000),
        { ok: false, refusal: "amount_invalid" },
        label,
      );
      assert.deepEqual(
        refundAmount(value, "EUR", 10_000),
        { ok: false, refusal: "amount_invalid" },
        label,
      );
      assert.equal(refusedWhateverTheCurrency(value, true), true, label);
    }
  });
});
