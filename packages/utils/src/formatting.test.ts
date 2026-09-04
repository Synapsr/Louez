import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatCurrency,
  formatCurrencyForSms,
  formatDate,
  formatDateRange,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatTime,
} from "./formatting";

test("formats public values in the caller locale", () => {
  assert.deepEqual(
    [
      formatNumber(1234.5, 1, "de-DE"),
      formatDate(new Date("2026-08-27T12:00:00.000Z"), undefined, "de-DE"),
    ],
    ["1.234,5", "27. August 2026"],
  );
});

test("formats currencies in the caller locale instead of the currency default", () => {
  assert.equal(formatCurrency(1234.5, "EUR", "de-DE"), "1.234,50 €");
});

test("uses the caller locale across the remaining public formatters", () => {
  const start = new Date(2026, 7, 26, 12, 0);
  const end = new Date(2026, 7, 27, 12, 0);

  assert.deepEqual(
    [
      formatCurrencyForSms(1234.5, "EUR", "de-DE"),
      formatPercent(12.5, "de-DE"),
      formatDateShort(end, "de-DE"),
      formatDateTime(end, "de-DE"),
      formatTime(end, "de-DE"),
      formatDateRange(start, end, "de-DE"),
    ],
    [
      "1.234,50 euros",
      "12,5 %",
      "27. Aug.",
      "27. August 2026 um 12:00",
      "12:00",
      "26 - 27. August 2026",
    ],
  );
});
