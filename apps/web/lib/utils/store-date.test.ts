import assert from "node:assert/strict";
import { test } from "node:test";

import { formatStoreDate } from "@/lib/utils/store-date";

const SAMPLE_DATE = new Date("2026-08-27T09:00:00.000Z");

test("localizes the connector between a store date and time", () => {
  assert.deepEqual(
    [
      formatStoreDate(SAMPLE_DATE, "UTC", "SHORT_DATETIME", "de"),
      formatStoreDate(SAMPLE_DATE, "UTC", "SHORT_DATETIME", "fr"),
    ],
    ["Do. 27 Aug. um 09:00", "jeu. 27 août à 09:00"],
  );
});
