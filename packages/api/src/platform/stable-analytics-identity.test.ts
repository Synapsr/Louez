import assert from "node:assert/strict";
import { test } from "node:test";

import { stableAnalyticsEventIdentity } from "./effects";

// A fact reported twice (a redelivered Stripe event) gets the same id and time,
// so PostHog keeps one event; another fact gets another id.

test("the same key and time give the same identity, a valid UUID", () => {
  const at = new Date("2026-11-17T10:00:00Z");
  const first = stableAnalyticsEventIdentity("stripe_event:evt_1", at);
  assert.deepEqual(stableAnalyticsEventIdentity("stripe_event:evt_1", at), first);
  assert.match(
    first.eventUuid,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(first.occurredAt, "2026-11-17T10:00:00.000Z");
});

test("another key gives another id", () => {
  const at = new Date();
  assert.notEqual(
    stableAnalyticsEventIdentity("stripe_event:evt_1", at).eventUuid,
    stableAnalyticsEventIdentity("stripe_event:evt_2", at).eventUuid,
  );
});
