import assert from "node:assert/strict";
import { test } from "node:test";

import type { BusinessHours } from "@louez/types";

import { formatRentalPeriod } from "@/lib/utils/store-date";
import {
  allowsSameDayRental,
  buildRentalQuickPresets,
  parseRentalPeriod,
  validateRentalPeriodSelection,
  type RentalPeriodRules,
} from "@/lib/utils/util.rental-period";

const TIMEZONE = "Europe/Paris";

const openDay = { isOpen: true, ranges: [{ openTime: "09:00", closeTime: "18:00" }] };
const closedDay = { isOpen: false, ranges: [] };

/** Monday to Saturday 09:00–18:00, closed on Sunday. */
const businessHours: BusinessHours = {
  enabled: true,
  schedule: {
    0: closedDay,
    1: openDay,
    2: openDay,
    3: openDay,
    4: openDay,
    5: openDay,
    6: openDay,
  },
  closurePeriods: [],
};

const dayRules: RentalPeriodRules = {
  pricingMode: "day",
  businessHours,
  timezone: TIMEZONE,
  advanceNoticeMinutes: 0,
  minRentalMinutes: 1440,
  maxRentalMinutes: 7 * 1440,
};

// Far in the future so the advance notice never interferes: 2030-03-04 is a Monday.
const paris = (iso: string) => new Date(`${iso}+01:00`);

const issueCode = (result: ReturnType<typeof validateRentalPeriodSelection>) =>
  result.ok ? "ok" : result.issue.code;

test("missing dates and reversed dates are reported before any store rule", () => {
  assert.equal(
    issueCode(validateRentalPeriodSelection({ start: undefined, end: undefined, rules: dayRules })),
    "missing_dates",
  );
  assert.equal(
    issueCode(
      validateRentalPeriodSelection({
        start: paris("2030-03-06T10:00:00"),
        end: paris("2030-03-04T10:00:00"),
        rules: dayRules,
      }),
    ),
    "end_before_start",
  );
});

test("same day is refused for day pricing with a one-day minimum, allowed under a day or by the hour", () => {
  assert.equal(allowsSameDayRental("day", 1440), false);
  assert.equal(allowsSameDayRental("day", 120), true);
  assert.equal(allowsSameDayRental("hour", 1440), true);
  assert.equal(
    issueCode(
      validateRentalPeriodSelection({
        start: paris("2030-03-04T09:00:00"),
        end: paris("2030-03-04T17:00:00"),
        rules: dayRules,
      }),
    ),
    "same_day_not_allowed",
  );
  assert.equal(
    issueCode(
      validateRentalPeriodSelection({
        start: paris("2030-03-04T09:00:00"),
        end: paris("2030-03-04T12:00:00"),
        rules: { ...dayRules, minRentalMinutes: 120 },
      }),
    ),
    "ok",
  );
});

test("opening hours, minimum and maximum duration follow the server rules", () => {
  const sundayReturn = validateRentalPeriodSelection({
    start: paris("2030-03-08T10:00:00"),
    end: paris("2030-03-10T10:00:00"),
    rules: dayRules,
  });
  assert.equal(issueCode(sundayReturn), "business_hours");

  const tooShort = validateRentalPeriodSelection({
    start: paris("2030-03-04T10:00:00"),
    end: paris("2030-03-05T09:00:00"),
    rules: dayRules,
  });
  assert.deepEqual(tooShort, { ok: false, issue: { code: "min_duration", duration: "1d" } });

  const tooLong = validateRentalPeriodSelection({
    start: paris("2030-03-04T10:00:00"),
    end: paris("2030-03-15T10:00:00"),
    rules: dayRules,
  });
  assert.deepEqual(tooLong, { ok: false, issue: { code: "max_duration", duration: "7d" } });

  const fine = validateRentalPeriodSelection({
    start: paris("2030-03-04T10:00:00"),
    end: paris("2030-03-06T10:00:00"),
    rules: dayRules,
  });
  assert.deepEqual(fine, { ok: true });
});

test("advance notice rejects a start inside the notice window", () => {
  const inTenMinutes = new Date(Date.now() + 10 * 60 * 1000);
  const result = validateRentalPeriodSelection({
    start: inTenMinutes,
    end: new Date(inTenMinutes.getTime() + 3 * 60 * 60 * 1000),
    rules: { pricingMode: "hour", advanceNoticeMinutes: 1440, minRentalMinutes: 60 },
  });
  assert.deepEqual(result, { ok: false, issue: { code: "advance_notice", duration: "1d" } });
});

test("quick presets skip closed days", () => {
  // 2030-03-05 is a Wednesday; the weekend preset starts Friday and ends Monday (Sunday closed).
  const presets = buildRentalQuickPresets(dayRules, new Date(2030, 2, 5, 12, 0, 0));
  const byKey = Object.fromEntries(presets.map((preset) => [preset.key, preset]));
  assert.deepEqual(Object.keys(byKey), ["thisWeekend", "oneWeek", "twoWeeks"]);
  assert.equal(byKey.thisWeekend.startDay.getDay(), 5);
  assert.equal(byKey.thisWeekend.endDay.getDay(), 1);
  assert.equal(byKey.oneWeek.startDay.getDate(), 6);
  assert.equal(byKey.oneWeek.endDay.getDay(), 3);
});

test("parseRentalPeriod needs two valid instants", () => {
  assert.equal(parseRentalPeriod(null, "2030-03-04T09:00:00.000Z"), null);
  assert.equal(parseRentalPeriod("nope", "2030-03-04T09:00:00.000Z"), null);
  const period = parseRentalPeriod("2030-03-04T09:00:00.000Z", "2030-03-06T17:00:00.000Z");
  assert.equal(period?.start.toISOString(), "2030-03-04T09:00:00.000Z");
  assert.equal(period?.end.toISOString(), "2030-03-06T17:00:00.000Z");
});

test("formatRentalPeriod compacts same-month, same-day and cross-month periods in the store timezone", () => {
  const now = new Date("2030-01-15T12:00:00Z");
  const options = { timezone: TIMEZONE, locale: "fr", now };
  assert.equal(
    formatRentalPeriod(paris("2030-03-03T09:00:00"), paris("2030-03-05T18:00:00"), options),
    "3–5 mars",
  );
  assert.equal(
    formatRentalPeriod(paris("2030-03-03T09:00:00"), paris("2030-03-03T18:00:00"), options),
    "3 mars · 09:00–18:00",
  );
  assert.equal(
    formatRentalPeriod(paris("2030-02-28T09:00:00"), paris("2030-03-02T18:00:00"), options),
    "28 févr. – 2 mars",
  );
  assert.equal(
    formatRentalPeriod(paris("2030-03-03T09:00:00"), paris("2030-03-05T18:00:00"), {
      ...options,
      style: "long",
    }),
    "3 mars 09:00 → 5 mars 18:00",
  );
  assert.equal(
    formatRentalPeriod(paris("2031-01-03T09:00:00"), paris("2031-01-05T18:00:00"), options),
    "3–5 janv. 2031",
  );
});
