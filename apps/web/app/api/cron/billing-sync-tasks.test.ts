import assert from "node:assert/strict";
import { test } from "node:test";

import { billingSyncTasks } from "./billing-sync-tasks";

test("every cron call runs the whole sync, the sweep included, whatever the hour", () => {
  for (let hour = 0; hour < 24; hour += 1) {
    const now = new Date(Date.UTC(2026, 9, 3, hour, 30));
    assert.deepEqual(
      billingSyncTasks(now).map(({ task, key }) => ({ task, key })),
      [
        { task: "billing-relay", key: "billingRelay" },
        { task: "billing-heartbeat", key: "billingHeartbeat" },
        { task: "billing-manifests", key: "billingManifests" },
        { task: "billing-sweep", key: "billingSweep" },
      ],
      `at ${now.toISOString()}`,
    );
  }
});
