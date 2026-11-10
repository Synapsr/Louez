import assert from "node:assert/strict";
import { test } from "node:test";

import { getPendingUrgency } from "./util.pending-urgency";
import {
  getStoreDay,
  getStoreDayOffset,
  getStoreDayStart,
  resolveStoreTimezone,
} from "./util.store-day";

test("a store's day follows its own timezone, not the server's", () => {
  // 00:30 in Paris on 11 November is still 10 November in UTC.
  const day = getStoreDay(new Date("2026-11-10T23:30:00.000Z"), "Europe/Paris");

  assert.equal(day.todayStart.toISOString(), "2026-11-10T23:00:00.000Z");
  assert.equal(day.tomorrowStart.toISOString(), "2026-11-11T23:00:00.000Z");
  assert.equal(day.monthStart.toISOString(), "2026-10-31T23:00:00.000Z");
  assert.equal(day.timeOfDay, "evening");
});

test("the month-to-date comparison stops at the same moment one month earlier", () => {
  const day = getStoreDay(new Date("2026-11-10T14:00:00.000Z"), "UTC");

  assert.equal(day.previousMonthStart.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(day.previousMonthNow.toISOString(), "2026-10-10T14:00:00.000Z");
});

test("the 31st compares to the last day of a shorter previous month", () => {
  const day = getStoreDay(new Date("2026-03-31T10:00:00.000Z"), "UTC");

  assert.equal(day.previousMonthNow.toISOString(), "2026-02-28T10:00:00.000Z");
});

test("a missing or unknown timezone falls back to UTC", () => {
  assert.equal(resolveStoreTimezone(undefined), "UTC");
  assert.equal(resolveStoreTimezone("  "), "UTC");
  assert.equal(resolveStoreTimezone("Mars/Olympus"), "UTC");
  assert.equal(resolveStoreTimezone("Europe/Paris"), "Europe/Paris");
});

test("day starts and offsets count calendar days on the store's clock", () => {
  const day = getStoreDay(new Date("2026-11-10T23:30:00.000Z"), "Europe/Paris");

  assert.equal(getStoreDayStart(day, 1).toISOString(), "2026-11-11T23:00:00.000Z");
  assert.equal(getStoreDayOffset(day, new Date("2026-11-11T08:00:00.000Z")), 0);
  assert.equal(getStoreDayOffset(day, new Date("2026-11-11T23:30:00.000Z")), 1);
  assert.equal(getStoreDayOffset(day, new Date("2026-11-10T20:00:00.000Z")), -1);
});

test("a pending request is flagged only when its start is close or already gone", () => {
  const day = getStoreDay(new Date("2026-11-10T10:00:00.000Z"), "UTC");

  assert.deepEqual(getPendingUrgency(day, new Date("2026-11-09T09:00:00.000Z")), { kind: "past" });
  assert.deepEqual(getPendingUrgency(day, new Date("2026-11-10T18:00:00.000Z")), { kind: "today" });
  assert.deepEqual(getPendingUrgency(day, new Date("2026-11-11T09:00:00.000Z")), {
    kind: "tomorrow",
  });
  assert.deepEqual(getPendingUrgency(day, new Date("2026-11-17T09:00:00.000Z")), {
    kind: "soon",
    days: 7,
  });
  assert.equal(getPendingUrgency(day, new Date("2026-11-18T09:00:00.000Z")), null);
});

test("store days move on the store's clock and read as stable keys", async () => {
  const { addStoreDays, storeDayKey } = await import("./util.store-day");
  const late = new Date("2026-11-10T23:30:00.000Z"); // already the 11th in Paris

  assert.equal(storeDayKey(late, "Europe/Paris"), "2026-11-11");
  assert.equal(addStoreDays(late, 7, "Europe/Paris").toISOString(), "2026-11-17T23:00:00.000Z");
  assert.equal(addStoreDays(late, -1, "Europe/Paris").toISOString(), "2026-11-09T23:00:00.000Z");
});

test("a day's agenda keeps active bookings that start or end on it", async () => {
  const { splitDay } = await import("./util.week-agenda");
  const at = (status: string, start: string, end: string) => ({
    status,
    startDate: new Date(start),
    endDate: new Date(end),
  });
  const { departures, returns } = splitDay(
    [
      at("confirmed", "2026-11-12T09:00:00Z", "2026-11-14T18:00:00Z"),
      at("pending", "2026-11-12T10:00:00Z", "2026-11-13T10:00:00Z"),
      at("ongoing", "2026-11-08T09:00:00Z", "2026-11-12T17:00:00Z"),
      at("cancelled", "2026-11-12T11:00:00Z", "2026-11-12T12:00:00Z"),
    ],
    "2026-11-12",
    "Europe/Paris",
  );

  assert.equal(departures.length, 1);
  assert.equal(returns.length, 1);
  assert.equal(returns[0].status, "ongoing");
});

test("the next activity is the first active day after the one picked, within reach", async () => {
  const { findNextActivity } = await import("./util.week-agenda");
  const at = (status: string, start: string, end: string) => ({
    status,
    startDate: new Date(start),
    endDate: new Date(end),
  });
  const reservations = [
    at("pending", "2026-11-13T09:00:00Z", "2026-11-14T09:00:00Z"),
    at("confirmed", "2026-11-20T09:00:00Z", "2026-11-22T17:00:00Z"),
    at("confirmed", "2026-11-20T14:00:00Z", "2026-11-25T17:00:00Z"),
  ];

  const next = findNextActivity(reservations, "2026-11-12", "2026-12-10", "Europe/Paris");
  assert.equal(next?.date.toISOString(), "2026-11-19T23:00:00.000Z");
  assert.equal(next?.departures, 2);
  assert.equal(next?.returns, 0);

  assert.equal(findNextActivity(reservations, "2026-11-12", "2026-11-18", "Europe/Paris"), null);
  assert.equal(
    findNextActivity(reservations, "2026-11-22", "2026-12-10", "Europe/Paris")?.returns,
    1,
  );
});

test("lateness reads in minutes, then hours, then the store's calendar days", async () => {
  const { getLateness } = await import("./util.lateness");
  const now = new Date("2026-11-10T10:10:00Z");
  assert.deepEqual(getLateness(new Date("2026-11-10T09:50:00Z"), now, "Europe/Paris"), {
    unit: "minutes",
    value: 20,
  });
  assert.deepEqual(getLateness(new Date("2026-11-10T05:00:00Z"), now, "Europe/Paris"), {
    unit: "hours",
    value: 5,
  });
  assert.deepEqual(getLateness(new Date("2026-11-04T17:00:00Z"), now, "Europe/Paris"), {
    unit: "days",
    value: 6,
  });
  // Yesterday 08:00, read more than 24 hours later: still yesterday, one day.
  assert.deepEqual(getLateness(new Date("2026-11-09T07:00:00Z"), now, "Europe/Paris"), {
    unit: "days",
    value: 1,
  });
});
