import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MIN_PASSWORD_LENGTH } from "@louez/auth/password-policy";

import { evaluatePasswordRules } from "./util.password-rules";

describe("evaluatePasswordRules", () => {
  test("ticks the length rule exactly at the minimum", () => {
    const tooShort = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    const longEnough = "a".repeat(MIN_PASSWORD_LENGTH);

    assert.deepEqual(evaluatePasswordRules(tooShort), [{ id: "minLength", met: false }]);
    assert.deepEqual(evaluatePasswordRules(longEnough), [{ id: "minLength", met: true }]);
  });

  test("starts with every rule unmet", () => {
    assert.ok(evaluatePasswordRules("").every((rule) => !rule.met));
  });
});
