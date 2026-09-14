import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalendarAvailabilityCandidates } from "./util.calendar-availability";
import type { RentalDateDraft } from "./core/types";

const draft: RentalDateDraft & { isDateDisabled: (day: Date) => boolean } = {
  startTime: "09:00",
  endTime: "18:00",
  endIsAuto: false,
  activeField: null,
  isDateDisabled: () => false,
};
const rules = { pricingMode: "day", minRentalMinutes: 60, timezone: "Europe/Paris" } as const;
const month = new Date(2030, 2, 1);

test("candidate windows respect store timezone across daylight saving", () => {
  const candidates = buildCalendarAvailabilityCandidates({ core: draft, rules, month, months: 1 });
  assert.equal(candidates.length, 31);
  assert.equal(
    candidates.find((day) => day.day === "2030-03-30")?.startDate,
    "2030-03-30T08:00:00.000Z",
  );
  assert.equal(
    candidates.find((day) => day.day === "2030-03-31")?.startDate,
    "2030-03-31T07:00:00.000Z",
  );
});

test("return candidates check the whole range including intermediate reservations", () => {
  const core = {
    ...draft,
    startDate: new Date(2030, 2, 10),
    endDate: new Date(2030, 2, 10),
    endIsAuto: true,
  };
  const candidates = buildCalendarAvailabilityCandidates({ core, rules, month, months: 1 });
  assert.deepEqual(
    candidates.find((day) => day.day === "2030-03-20"),
    {
      day: "2030-03-20",
      startDate: "2030-03-10T08:00:00.000Z",
      endDate: "2030-03-20T17:00:00.000Z",
    },
  );
  assert.equal(
    candidates.find((day) => day.day === "2030-03-05")?.startDate,
    "2030-03-05T08:00:00.000Z",
  );
});

test("closed days are skipped and completed ranges restart with current times", () => {
  const core = {
    ...draft,
    startDate: new Date(2030, 2, 10),
    endDate: new Date(2030, 2, 12),
    startTime: "14:00",
    isDateDisabled: (day: Date) => day.getDate() === 15,
  };
  const candidates = buildCalendarAvailabilityCandidates({ core, rules, month, months: 2 });
  assert.equal(
    candidates.some((day) => day.day === "2030-03-15"),
    false,
  );
  assert.equal(
    candidates.find((day) => day.day === "2030-03-20")?.startDate,
    "2030-03-20T13:00:00.000Z",
  );
  assert.ok(candidates.some((day) => day.day === "2030-04-30"));
});
