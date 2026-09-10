import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { createTranslator } from "next-intl";

const directory = new URL("../../../messages/", import.meta.url);
const locales = readdirSync(directory).filter((name) => name.endsWith(".json"));

for (const file of locales) {
  test(`${file}: reservation detail copy resolves`, () => {
    const messages = JSON.parse(readFileSync(new URL(file, directory), "utf8"));
    const t = createTranslator({
      locale: file.replace(".json", ""),
      messages,
      namespace: "storefront.account",
      onError: (error) => {
        throw error;
      },
    });

    for (const key of [
      "nothingChargedYet",
      "timeline.title",
      "fulfillment.pickupTitle",
      "fulfillment.returnTitle",
      "fulfillment.deliveredToYou",
      "fulfillment.collectedFromYou",
      "fulfillment.sameAsPickup",
      "fulfillment.storeFallback",
      "fulfillment.directions",
    ]) {
      assert.ok(t.has(key), `Missing ${key}`);
      assert.notEqual(t(key), key);
    }

    // The calendar lines are the only place a customer reads the two places
    // outside the page, so both placeholders have to survive translation.
    for (const key of ["fulfillment.calendarPickup", "fulfillment.calendarReturn"]) {
      const line = t(key, { when: "WHEN", place: "PLACE" });
      assert.ok(line.includes("WHEN"), `${file}: ${key} drops {when}`);
      assert.ok(line.includes("PLACE"), `${file}: ${key} drops {place}`);
    }

    // The pending status names the address the store's answer will land on,
    // so every locale has to carry the placeholder through.
    const email = "someone@example.test";
    const nextStep = t("status.pendingNextStep", { email });
    assert.ok(nextStep.includes(email), `${file}: pendingNextStep drops {email}`);
  });
}
