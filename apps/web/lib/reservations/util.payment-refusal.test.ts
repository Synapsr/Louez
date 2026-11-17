import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { PAYMENT_REFUSAL_KEYS, paymentRefusalKey } from "./util.payment-refusal";

test("a payment action's refusal is its own message, anything else the generic one", () => {
  // The router answers a refusal as an error whose message is the action's key.
  assert.equal(paymentRefusalKey(new Error("errors.amountExceedsDeposit")), "amountExceedsDeposit");
  assert.equal(paymentRefusalKey(new Error("errors.amountTooPrecise")), "amountTooPrecise");
  assert.equal(paymentRefusalKey(new Error("Failed to fetch")), null);
  assert.equal(paymentRefusalKey(new Error("errors.somethingElse")), null);
  assert.equal(paymentRefusalKey("errors.invalidAmount"), null);
});

test("every refusal a toast shows is translated at the root of every locale", () => {
  const folder = new URL("../../messages/", import.meta.url);
  const locales = readdirSync(folder).filter((name) => name.endsWith(".json"));
  assert.equal(locales.length, 13);
  for (const file of locales) {
    const errors = (
      JSON.parse(readFileSync(new URL(file, folder), "utf8")) as {
        errors: Record<string, unknown>;
      }
    ).errors;
    for (const key of PAYMENT_REFUSAL_KEYS) {
      const name = key.slice("errors.".length);
      assert.equal(typeof errors[name], "string", `${file}: errors.${name}`);
    }
  }
});
