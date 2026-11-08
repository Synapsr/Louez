import assert from "node:assert/strict";
import { test } from "node:test";

import { getMinStartDateTime, validateAdvanceNotice } from "./advance-notice";

const NOW = new Date("2026-08-11T10:00:00.000Z");

test("accepts a start exactly at the advance notice boundary", () => {
  const startDate = new Date("2026-08-12T10:00:00.000Z");

  assert.deepEqual(validateAdvanceNotice(startDate, 24 * 60, NOW), {
    valid: true,
  });
});

test("rejects a start one millisecond before the advance notice boundary", () => {
  const startDate = new Date("2026-08-12T09:59:59.999Z");
  const minimumStartTime = getMinStartDateTime(24 * 60, NOW);

  assert.deepEqual(validateAdvanceNotice(startDate, 24 * 60, NOW), {
    valid: false,
    minimumStartTime,
  });
});

test("does not restrict the start date when advance notice is disabled", () => {
  const pastStartDate = new Date("2026-08-10T10:00:00.000Z");

  assert.deepEqual(validateAdvanceNotice(pastStartDate, 0, NOW), {
    valid: true,
  });
});

test("revalidates a previously acceptable date against the current clock", () => {
  const startDate = new Date("2026-08-12T10:00:00.000Z");
  const laterNow = new Date("2026-08-11T10:00:00.001Z");

  assert.equal(validateAdvanceNotice(startDate, 24 * 60, NOW).valid, true);
  assert.equal(validateAdvanceNotice(startDate, 24 * 60, laterNow).valid, false);
});
