import assert from "node:assert/strict";
import { test } from "node:test";

import { showsOverbookedBadge, showsTurnoverBufferOverriddenBadge } from "./capacity-verdict-badge";

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

test("a confirmation past the turnover buffer shows its own badge, apart from the overbooked one", () => {
  const metadata = { overbooked: false, turnoverBufferOverridden: true };
  assert.equal(showsTurnoverBufferOverriddenBadge({ activityType: "confirmed", metadata }), true);
  assert.equal(showsOverbookedBadge({ activityType: "confirmed", metadata }), false);
  // Short both ways: both badges.
  const both = { overbooked: true, turnoverBufferOverridden: true };
  assert.equal(
    showsTurnoverBufferOverriddenBadge({ activityType: "confirmed", metadata: both }),
    true,
  );
  assert.equal(showsOverbookedBadge({ activityType: "confirmed", metadata: both }), true);
});

test("the flag with nothing past the buffer, or a row without it, shows no buffer badge", () => {
  for (const metadata of [{ turnoverBufferOverridden: false }, { overbooked: true }, {}, null]) {
    assert.equal(
      showsTurnoverBufferOverriddenBadge({ activityType: "confirmed", metadata }),
      false,
      JSON.stringify(metadata),
    );
  }
  assert.equal(
    showsTurnoverBufferOverriddenBadge({
      activityType: "picked_up",
      metadata: { turnoverBufferOverridden: true },
    }),
    false,
  );
});
