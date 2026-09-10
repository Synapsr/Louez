import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { createTranslator } from "next-intl";

const directory = new URL("../../../messages/", import.meta.url);
const locales = readdirSync(directory).filter((name) => name.endsWith(".json"));

for (const file of locales) {
  test(`${file}: checkout outcomes and blocked cart messages resolve`, () => {
    const messages = JSON.parse(readFileSync(new URL(file, directory), "utf8"));
    const t = createTranslator({
      locale: file.replace(".json", ""),
      messages,
      onError: (error) => {
        throw error;
      },
    });
    for (const event of [
      "paid",
      "payment_received",
      "deposit_authorized",
      "requested",
      "processing",
    ]) {
      for (const field of ["title", "description"]) {
        const key = `storefront.account.outcome.${event}.${field}`;
        assert.ok(t.has(key), `Missing ${key}`);
        assert.notEqual(t(key), key);
      }
    }
    for (const field of ["checking", "checkoutBlocked", "resolveError"]) {
      const key = `storefront.cart.${field}`;
      assert.ok(t.has(key), `Missing ${key}`);
      assert.notEqual(t(key), key);
    }
  });
}
