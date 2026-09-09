import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BusinessHours } from "@louez/types";

import { formatStoreClockTime, getStoreStatus } from "./util.store-status";

const TIMEZONE = "Europe/Paris";

const closedDay = { isOpen: false, ranges: [] };
const weekday = { isOpen: true, ranges: [{ openTime: "09:00", closeTime: "18:00" }] };
const splitDay = {
  isOpen: true,
  ranges: [
    { openTime: "09:00", closeTime: "12:00" },
    { openTime: "14:00", closeTime: "18:00" },
  ],
};

const hours: BusinessHours = {
  enabled: true,
  schedule: {
    0: closedDay,
    1: weekday,
    2: weekday,
    3: splitDay,
    4: weekday,
    5: weekday,
    6: closedDay,
  },
  closurePeriods: [],
};

// Paris is UTC+1 in January: 10:00 local = 09:00Z.
const parisInstant = (isoLocal: string) => new Date(`${isoLocal}+01:00`);

describe("getStoreStatus", () => {
  it("is null without configured hours", () => {
    assert.equal(getStoreStatus(undefined, TIMEZONE), null);
    assert.equal(getStoreStatus({ ...hours, enabled: false }, TIMEZONE), null);
  });

  it("is open during a range and says when it closes", () => {
    // Monday 2026-01-05 10:00 Paris.
    const status = getStoreStatus(hours, TIMEZONE, parisInstant("2026-01-05T10:00:00"));
    assert.deepEqual(status, { isOpen: true, closesAt: "18:00", nextOpening: null, reason: null });
  });

  it("is closed at the exact closing time", () => {
    const status = getStoreStatus(hours, TIMEZONE, parisInstant("2026-01-05T18:00:00"));
    assert.equal(status?.isOpen, false);
    assert.equal(status?.reason, "outside_hours");
    assert.equal(status?.nextOpening?.dayOffset, 1);
    assert.equal(status?.nextOpening?.time, "09:00");
  });

  it("points to today's first range before opening", () => {
    const status = getStoreStatus(hours, TIMEZONE, parisInstant("2026-01-05T08:30:00"));
    assert.equal(status?.isOpen, false);
    assert.deepEqual(status?.nextOpening?.dayOffset, 0);
    assert.equal(status?.nextOpening?.time, "09:00");
  });

  it("reports a break between two ranges", () => {
    // Wednesday 2026-01-07 13:00 Paris.
    const status = getStoreStatus(hours, TIMEZONE, parisInstant("2026-01-07T13:00:00"));
    assert.equal(status?.reason, "break");
    assert.equal(status?.nextOpening?.time, "14:00");
    assert.equal(status?.nextOpening?.dayOffset, 0);
  });

  it("skips closed days when looking for the next opening", () => {
    // Saturday 2026-01-10 11:00 Paris → Monday.
    const status = getStoreStatus(hours, TIMEZONE, parisInstant("2026-01-10T11:00:00"));
    assert.equal(status?.reason, "closed_today");
    assert.equal(status?.nextOpening?.dayOffset, 2);
    assert.equal(status?.nextOpening?.time, "09:00");
  });

  it("honours a full-day closure period", () => {
    const closed: BusinessHours = {
      ...hours,
      closurePeriods: [
        { id: "x", name: "Inventaire", startDate: "2026-01-05", endDate: "2026-01-05" },
      ],
    };
    const status = getStoreStatus(closed, TIMEZONE, parisInstant("2026-01-05T10:00:00"));
    assert.equal(status?.reason, "closure_period");
    assert.equal(status?.nextOpening?.dayOffset, 1);
  });
});

describe("formatStoreClockTime", () => {
  it("formats a store clock time in the visitor's locale", () => {
    assert.equal(formatStoreClockTime("18:00", "fr-FR"), "18:00");
    assert.equal(formatStoreClockTime("09:30", "en-US"), "9:30 AM");
  });
});
