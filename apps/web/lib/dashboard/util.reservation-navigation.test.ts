import assert from "node:assert/strict";
import { test } from "node:test";

import { tryRestoreReservationTimelineHistory } from "@/lib/dashboard/util.reservation-navigation";

test("restores the existing timeline history entry for the reservation back button", () => {
  let backCalls = 0;

  const restored = tryRestoreReservationTimelineHistory({
    historyLength: 2,
    restoreHistory: () => {
      backCalls += 1;
    },
    returnTo: "/dashboard/reservations?view=calendar&date=2026-08-13",
    source: "reservations_timeline",
  });

  assert.equal(restored, true);
  assert.equal(backCalls, 1);
});

test("keeps link navigation as a fallback when there is no timeline history entry", () => {
  let backCalls = 0;

  const restored = tryRestoreReservationTimelineHistory({
    historyLength: 1,
    restoreHistory: () => {
      backCalls += 1;
    },
    returnTo: "/dashboard/reservations?view=calendar&date=2026-08-13",
    source: "reservations_timeline",
  });

  assert.equal(restored, false);
  assert.equal(backCalls, 0);
});

test("does not restore history for invalid or unrelated return destinations", () => {
  const restoreHistory = () => {
    assert.fail("history should not be restored");
  };

  assert.equal(
    tryRestoreReservationTimelineHistory({
      historyLength: 2,
      restoreHistory,
      returnTo: "https://example.com",
      source: "reservations_timeline",
    }),
    false,
  );
  assert.equal(
    tryRestoreReservationTimelineHistory({
      historyLength: 2,
      restoreHistory,
      returnTo: "/dashboard/reservations?view=calendar&date=2026-08-13",
      source: "reservations_list",
    }),
    false,
  );
});
