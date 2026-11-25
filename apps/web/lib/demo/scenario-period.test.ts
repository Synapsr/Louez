import assert from "node:assert/strict";
import { test } from "node:test";

import { scenarioPeriod } from "./scenario-period";
import { DEMO_VERTICAL_KEYS, DEMO_VERTICALS } from "./verticals";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short" });
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
});
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Every day of a fortnight, around the clock: the guide's period is always one
// the storefront accepts (past the advance notice, at an opening time).
for (const key of DEMO_VERTICAL_KEYS) {
  const vertical = DEMO_VERTICALS[key];
  test(`${key}: scenario periods start on their weekday, after the notice, in whole open days`, () => {
    for (let hour = 0; hour < 14 * 24; hour += 5) {
      const now = new Date(Date.UTC(2026, 11, 1, hour));
      for (const scenario of vertical.scenarios) {
        const { start, end } = scenarioPeriod(vertical, scenario, now);
        assert.equal(WEEKDAY.format(start), DAYS[scenario.startWeekday]);
        assert.ok(
          start.getTime() - now.getTime() >= vertical.settings.advanceNoticeMinutes * 60_000,
          `${scenario.key} at ${now.toISOString()}`,
        );
        assert.ok(end.getTime() - start.getTime() >= scenario.days * 86_400_000 - 3_600_000);
        // Whole days: both ends at the same time of day, within an opening range.
        assert.equal(CLOCK.format(start), CLOCK.format(end));
        for (const at of [start, end]) {
          const day = vertical.settings.openingHours[DAYS.indexOf(WEEKDAY.format(at))];
          assert.ok(day, `${scenario.key}: open on ${at.toISOString()}`);
          const clock = CLOCK.format(at);
          assert.ok(
            day.some((range) => range.openTime <= clock && clock < range.closeTime),
            `${scenario.key}: ${clock} in opening hours`,
          );
        }
      }
    }
  });
}
