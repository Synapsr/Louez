import assert from "node:assert/strict";
import { test } from "node:test";

import { typedAmount } from "./util.typed-amount";

test("each notation a number input yields for a plain decimal becomes that decimal, as text", () => {
  const table: Array<[string, string]> = [
    [".5", "0.5"],
    ["-.5", "-0.5"],
    ["12.", "12"],
    ["+7", "7"],
    ["+.25", "0.25"],
    [" 7.5 ", "7.5"],
    ["\t20.00\n", "20.00"],
    // No rounding, no number in between.
    ["19.999", "19.999"],
    ["0.1000000000000000001", "0.1000000000000000001"],
    ["19.9999999999999999", "19.9999999999999999"],
    ["007.5", "007.5"],
    ["-20.05", "-20.05"],
  ];
  for (const [typed, normalised] of table) {
    assert.equal(typedAmount(typed), normalised, JSON.stringify(typed));
  }
});

test("any other text is left for the writes to refuse, as it is", () => {
  for (const typed of [
    "5e2",
    "1E3",
    "1,5",
    "1.500,00",
    "1 500,00",
    ".",
    "+",
    "-",
    "",
    "+-5",
    "12abc",
    "..5",
  ]) {
    assert.equal(typedAmount(typed), typed.trim(), JSON.stringify(typed));
  }
});

test("what is not text is no amount", () => {
  for (const raw of [7, [7], { amount: "7" }, null, undefined, BigInt(7), true]) {
    assert.equal(typedAmount(raw), null, String(raw));
  }
});
