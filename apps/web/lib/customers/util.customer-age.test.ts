import assert from "node:assert/strict";
import { test } from "node:test";

import { getAgeFromBirthDate } from "./util.customer-age";

test("age counts completed years and turns over on the birthday itself", () => {
  const today = new Date(2026, 8, 18);
  assert.equal(getAgeFromBirthDate("1991-03-14", today), 35);
  assert.equal(getAgeFromBirthDate("1991-09-18", today), 35);
  assert.equal(getAgeFromBirthDate("1991-09-19", today), 34);
  assert.equal(getAgeFromBirthDate("2026-09-18", today), 0);
});

test("unusable dates give no age", () => {
  const today = new Date(2026, 8, 18);
  assert.equal(getAgeFromBirthDate("", today), null);
  assert.equal(getAgeFromBirthDate("14/03/1991", today), null);
  assert.equal(getAgeFromBirthDate("2030-01-01", today), null);
  assert.equal(getAgeFromBirthDate("1800-01-01", today), null);
});
