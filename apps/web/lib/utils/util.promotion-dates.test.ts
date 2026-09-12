import assert from "node:assert/strict";
import { test } from "node:test";

import { pickPromotionDay, promotionDayToDate } from "./util.promotion-dates";

const open = { startsOn: null, endsOn: null };

test("the first day opens an offer with no end", () => {
  assert.deepEqual(pickPromotionDay(open, "2026-09-20"), {
    startsOn: "2026-09-20",
    endsOn: null,
  });
});

test("the next day on or after the start closes the offer", () => {
  const dates = { startsOn: "2026-09-20", endsOn: null };
  assert.deepEqual(pickPromotionDay(dates, "2026-09-30"), {
    startsOn: "2026-09-20",
    endsOn: "2026-09-30",
  });
  assert.deepEqual(pickPromotionDay(dates, "2026-09-20"), {
    startsOn: "2026-09-20",
    endsOn: "2026-09-20",
  });
});

test("a running offer is extended or shortened without losing its start", () => {
  const dates = { startsOn: "2026-09-01", endsOn: "2026-09-30" };
  assert.deepEqual(pickPromotionDay(dates, "2026-10-15"), {
    startsOn: "2026-09-01",
    endsOn: "2026-10-15",
  });
  assert.deepEqual(pickPromotionDay(dates, "2026-09-10"), {
    startsOn: "2026-09-01",
    endsOn: "2026-09-10",
  });
});

test("a day before the start moves the start and keeps the end", () => {
  assert.deepEqual(
    pickPromotionDay({ startsOn: "2026-09-10", endsOn: "2026-09-30" }, "2026-09-05"),
    {
      startsOn: "2026-09-05",
      endsOn: "2026-09-30",
    },
  );
});

test("an offer starting now only moves its end", () => {
  assert.deepEqual(pickPromotionDay({ startsOn: null, endsOn: "2026-09-30" }, "2026-09-15"), {
    startsOn: null,
    endsOn: "2026-09-15",
  });
});

test("a calendar day becomes local midnight", () => {
  const date = promotionDayToDate("2026-03-29");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 2);
  assert.equal(date.getDate(), 29);
  assert.equal(date.getHours(), 0);
});
