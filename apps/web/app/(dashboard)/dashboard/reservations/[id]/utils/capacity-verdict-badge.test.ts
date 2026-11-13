import assert from "node:assert/strict";
import { test } from "node:test";

import { showsOverbookedBadge } from "./capacity-verdict-badge";

test("a creation, an edit or a confirmation booked over the stock shows the badge", () => {
  for (const activityType of ["created", "modified", "confirmed"]) {
    assert.equal(
      showsOverbookedBadge({ activityType, metadata: { overbooked: true } }),
      true,
      activityType,
    );
  }
});

test("a verdict that fits, or a row without one, shows no badge", () => {
  for (const activityType of ["created", "modified", "confirmed"]) {
    for (const metadata of [{ overbooked: false }, {}, null]) {
      assert.equal(
        showsOverbookedBadge({ activityType, metadata }),
        false,
        `${activityType} ${JSON.stringify(metadata)}`,
      );
    }
  }
});

test("a row that carries no verdict shows no badge, whatever its metadata says", () => {
  assert.equal(
    showsOverbookedBadge({ activityType: "picked_up", metadata: { overbooked: true } }),
    false,
  );
});
