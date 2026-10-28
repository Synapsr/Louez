import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createRunLimit } from "./locks";

// The per-process limit on runs that hold a pooled connection (fee reversals).

/** A run that ends when the test says so. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe("createRunLimit", () => {
  test("a run past the limit waits for one to end, then runs", async () => {
    const limited = createRunLimit(2);
    const started: number[] = [];
    const gates = [gate(), gate(), gate()];
    const runs = gates.map((runGate, index) =>
      limited(1_000, async () => {
        started.push(index);
        await runGate.opened;
        return index;
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [0, 1]);

    gates[1]?.open();
    assert.deepEqual(await runs[1], { ran: true, value: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, [0, 1, 2]);

    gates[0]?.open();
    gates[2]?.open();
    assert.deepEqual(await Promise.all([runs[0], runs[2]]), [
      { ran: true, value: 0 },
      { ran: true, value: 2 },
    ]);
  });

  test("a run that waits too long does not run, and leaves its place free", async () => {
    const limited = createRunLimit(1);
    const blocker = gate();
    const first = limited(1_000, () => blocker.opened);
    let ranLate = false;
    assert.deepEqual(
      await limited(20, async () => {
        ranLate = true;
      }),
      { ran: false },
    );
    assert.equal(ranLate, false);

    blocker.open();
    await first;
    // The run that gave up holds no place: the next one runs at once.
    assert.deepEqual(await limited(0, async () => "next"), { ran: true, value: "next" });
  });

  test("a run that throws frees its place", async () => {
    const limited = createRunLimit(1);
    await assert.rejects(
      limited(1_000, async () => {
        throw new Error("Stripe is down");
      }),
      /Stripe is down/,
    );
    assert.deepEqual(await limited(0, async () => "after"), { ran: true, value: "after" });
  });
});
