import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { createTranslator } from "next-intl";

import { reservationActivity } from "@louez/db/schema";

// The reservation's history titles each event `activity.<type>`: a type with
// no label in a locale shows its raw key there.
const directory = new URL("../../../../../messages/", import.meta.url);
const locales = readdirSync(directory).filter((name) => name.endsWith(".json"));

for (const file of locales) {
  test(`${file}: every reservation activity has a history label`, () => {
    const messages = JSON.parse(readFileSync(new URL(file, directory), "utf8"));
    const t = createTranslator({
      locale: file.replace(".json", ""),
      messages,
      namespace: "dashboard.reservations.activity",
      onError: (error) => {
        throw error;
      },
    });

    for (const type of reservationActivity.activityType.enumValues) {
      assert.ok(t.has(type), `Missing activity.${type}`);
      assert.notEqual(t(type), type);
    }
  });
}
