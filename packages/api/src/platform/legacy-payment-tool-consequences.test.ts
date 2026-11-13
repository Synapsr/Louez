import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LEGACY_PAYMENT_TOOLS,
  legacyPaymentToolConsequences,
} from "./legacy-payment-tool-consequences";

// The temporary conversion of the payment tools' `always`, until they become
// procedures (pull request 6): money, for them alone.

describe("legacyPaymentToolConsequences", () => {
  test("the three payment tools that say `always` declare money", () => {
    assert.deepEqual(LEGACY_PAYMENT_TOOLS, [
      "record_payment",
      "delete_payment",
      "record_deposit_return",
    ]);
    for (const tool of LEGACY_PAYMENT_TOOLS) {
      assert.deepEqual(legacyPaymentToolConsequences(tool, true), ["money"]);
    }
  });

  test("one of them without `always` is refused", () => {
    for (const always of [false, undefined]) {
      assert.throws(
        () => legacyPaymentToolConsequences("record_payment", always),
        /record_payment/,
      );
    }
  });

  test("any other tool is refused, with `always` or not", () => {
    for (const always of [true, false, undefined]) {
      assert.throws(() => legacyPaymentToolConsequences("cancel_reservation", always), {
        message:
          /MCP tool cancel_reservation: only record_payment, delete_payment, record_deposit_return/,
      });
    }
  });
});
