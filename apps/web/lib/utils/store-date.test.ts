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

test("CJK dates follow local year/month/day ordering and store timezone", () => {
  const instant = new Date("2026-08-26T23:00:00.000Z");
  for (const locale of ["zh", "ja", "ko"]) {
    const value = formatStoreDate(instant, "Asia/Tokyo", "MEDIUM_DATE", locale);
    assert.ok(value.indexOf("2026") < value.indexOf("8"), value);
    assert.ok(value.includes("27"), value);
    assert.equal(formatStoreDate(instant, "Asia/Tokyo", "TIME_ONLY", locale), "08:00");
  }
});
