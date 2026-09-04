import assert from "node:assert/strict";
import { test } from "node:test";

import { calendarDateParser, toCalendarDateParam } from "./calendar-query";

test("round-trips a calendar date through the URL param", () => {
  const date = new Date(2026, 6, 8);

  assert.equal(calendarDateParser.serialize(date), "2026-07-08");
  assert.deepEqual(calendarDateParser.parse("2026-07-08"), date);
});

test("serializes the local calendar day, not the UTC one", () => {
  // Late-evening local time is already the next day in UTC — the param has to
  // stay on the day the user is looking at.
  assert.equal(calendarDateParser.serialize(new Date(2026, 6, 8, 23, 30)), "2026-07-08");
});

test("resolves `today` to the start of the current day", () => {
  const parsed = calendarDateParser.parse("today");

  assert.ok(parsed instanceof Date);
  assert.equal(toCalendarDateParam(parsed), toCalendarDateParam(new Date()));
  assert.equal(parsed.getHours(), 0);
  assert.equal(parsed.getMinutes(), 0);
  assert.equal(parsed.getSeconds(), 0);
  assert.equal(parsed.getMilliseconds(), 0);
});

test("rejects values that are not a plain calendar day", () => {
  assert.equal(calendarDateParser.parse(""), null);
  assert.equal(calendarDateParser.parse("tomorrow"), null);
  assert.equal(calendarDateParser.parse("2026-7-8"), null);
  assert.equal(calendarDateParser.parse("2026-07-08T10:00:00Z"), null);
});

test("rejects well-formed dates that do not exist", () => {
  // `new Date(2026, 1, 30)` silently rolls over to March 2nd — the parser has
  // to catch that instead of moving the user to another month.
  assert.equal(calendarDateParser.parse("2026-02-30"), null);
  assert.equal(calendarDateParser.parse("2026-13-01"), null);
  assert.equal(calendarDateParser.parse("2026-00-10"), null);
});

test("compares dates by value so an unchanged day is not a new value", () => {
  const date = new Date(2026, 6, 8);

  assert.equal(calendarDateParser.eq(date, new Date(2026, 6, 8)), true);
  assert.equal(calendarDateParser.eq(date, new Date(2026, 6, 9)), false);
});
