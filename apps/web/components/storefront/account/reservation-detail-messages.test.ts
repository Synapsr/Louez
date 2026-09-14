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
      "depositCard.title",
      "depositCard.authorize",
      "depositCard.reason",
      "updates.title",
      "updates.deposit_captured",
      "updates.inspection_signed",
      "inspections.title",
      "inspections.download",
      "paymentHistory.holdStatus.authorized",
      "paymentHistory.holdStatus.cancelled",
      "paymentHistory.holdStatus.completed",
      "paymentHistory.types.refund",
      "damageFees",
      "remainingDue",
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

  test(`${file}: deposit states and history keep their placeholders`, () => {
    const messages = JSON.parse(readFileSync(new URL(file, directory), "utf8"));
    const t = createTranslator({
      locale: file.replace(".json", ""),
      messages,
      namespace: "storefront.account",
      onError: (error) => {
        throw error;
      },
    });

    // Every deposit state is a badge, a title and a description built
    // around the amount, so a locale that loses the placeholder would tell
    // the customer nothing.
    const params = {
      amount: "AMOUNT",
      captured: "CAPTURED",
      returned: "RETURNED",
      method: "METHOD",
      date: "DATE",
    };
    for (const state of [
      "to_provide",
      "to_provide_online",
      "card_saved",
      "held",
      "hold_expired",
      "released",
      "captured",
      "failed",
      "collected",
      "returned",
      "partially_returned",
    ]) {
      for (const part of ["badge", "title"]) {
        assert.ok(t.has(`depositCard.states.${state}.${part}`), `Missing ${state}.${part}`);
      }
      const description = t(`depositCard.states.${state}.description`, params);
      assert.ok(description.includes("AMOUNT"), `${file}: ${state} drops {amount}`);
    }
    assert.ok(t("depositCard.states.captured.description", params).includes("CAPTURED"));
    assert.ok(t("depositCard.states.collected.description", params).includes("METHOD"));
    assert.ok(t("depositCard.states.partially_returned.description", params).includes("RETURNED"));

    for (const key of [
      "payment_received_amount",
      "deposit_authorized_amount",
      "deposit_captured_amount",
      "refunded_amount",
      "payment_added_rental",
      "payment_added_deposit",
      "payment_added_deposit_return",
      "payment_added_damage",
      "payment_added_adjustment",
    ]) {
      assert.ok(t(`updates.${key}`, params).includes("AMOUNT"), `${file}: ${key} drops {amount}`);
    }
    assert.ok(t("inspections.photoCount", { count: 3 }).includes("3"));
  });
}
