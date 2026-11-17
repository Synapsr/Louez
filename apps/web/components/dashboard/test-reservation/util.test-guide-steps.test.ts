import assert from "node:assert/strict";
import { test } from "node:test";

import { testGuideState } from "./util.test-guide-steps";

const base = { inspectionsEnabled: false, hasDepartureInspection: false };

test("a request starts at the confirmation", () => {
  const state = testGuideState({ ...base, status: "pending" });
  assert.equal(state.kind, "steps");
  if (state.kind !== "steps") return;
  assert.deepEqual(
    state.steps.map((step) => [step.key, step.done]),
    [
      ["confirm", false],
      ["pickup", false],
      ["return", false],
    ],
  );
  assert.equal(state.current, "confirm");
});

test("a paid test starts at the departure, with its inspection when the store asks one", () => {
  const plain = testGuideState({ ...base, status: "confirmed" });
  assert.equal(plain.kind === "steps" && plain.current, "pickup");

  const inspected = testGuideState({ ...base, inspectionsEnabled: true, status: "confirmed" });
  assert.equal(inspected.kind === "steps" && inspected.current, "departureInspection");

  const afterInspection = testGuideState({
    inspectionsEnabled: true,
    hasDepartureInspection: true,
    status: "confirmed",
  });
  assert.equal(afterInspection.kind === "steps" && afterInspection.current, "return");
});

test("picked up, only the return is left; returned, the test is done", () => {
  const ongoing = testGuideState({ ...base, status: "ongoing" });
  assert.equal(ongoing.kind === "steps" && ongoing.current, "return");
  assert.deepEqual(testGuideState({ ...base, status: "completed" }), { kind: "done" });
});

test("a cancelled or rejected test has nothing left to rehearse", () => {
  for (const status of ["cancelled", "rejected", "declined"] as const) {
    assert.deepEqual(testGuideState({ ...base, status }), { kind: "closed" });
  }
});
