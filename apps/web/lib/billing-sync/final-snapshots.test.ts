import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FINAL_STORE_ALERT_BYTES,
  alertFinalSnapshotProblems,
  finalStoreSizeProblem,
} from "./final-snapshots";
import { MAX_EVENT_BYTES } from "./relay";

// A deleted store's final body lists every reservation it closes, so a large store can
// outgrow the relay's event limit (README §5.6). Until the contract splits the list,
// the deletion raises it.

const STORE = "store_final_large_01";
const body = (count: number) => ({
  deleted: true,
  slug: null,
  finalReservations: Array.from({ length: count }, (_, index) => ({
    aggregateId: `res_${String(index).padStart(17, "0")}`,
    version: 12,
  })),
});

function captured() {
  const alerts: Array<{ kind: string; message: string }> = [];
  return {
    alerts,
    sink: {
      log: { error: () => undefined, info: () => undefined },
      alert: async (kind: string, message: string) => void alerts.push({ kind, message }),
    },
  };
}

test("a final store body far from the event limit raises nothing", async () => {
  assert.equal(finalStoreSizeProblem(STORE, body(0)), null);
  assert.equal(finalStoreSizeProblem(STORE, body(3000)), null);
  const { alerts, sink } = captured();
  await alertFinalSnapshotProblems([], sink);
  assert.deepEqual(alerts, []);
});

test("a final store body near or above the event limit is raised", async () => {
  const near = finalStoreSizeProblem(STORE, body(4500));
  assert.equal(near?.kind, "store_too_large");
  assert.ok(near?.kind === "store_too_large" && near.bytes >= FINAL_STORE_ALERT_BYTES);
  assert.ok(near?.kind === "store_too_large" && near.bytes <= MAX_EVENT_BYTES);
  const above = finalStoreSizeProblem(STORE, body(6000));
  assert.ok(above?.kind === "store_too_large" && above.bytes > MAX_EVENT_BYTES);
  assert.equal(above?.kind === "store_too_large" && above.finalReservations, 6000);

  const { alerts, sink } = captured();
  await alertFinalSnapshotProblems([near, above].filter((problem) => problem !== null), sink);
  assert.deepEqual(
    alerts.map((alert) => alert.kind),
    ["final_snapshot_large", "final_snapshot_large"],
  );
  assert.match(alerts[0]?.message ?? "", new RegExp(`${STORE} lists 4500 reservations.*close to the limit`));
  assert.match(alerts[1]?.message ?? "", /lists 6000 reservations.*the relay will mark the row dead/);
});
