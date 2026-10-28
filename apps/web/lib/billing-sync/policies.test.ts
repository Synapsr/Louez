import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPullLimiter } from "./policies";

// The per-store pull limit of README §4.4: one pull per store every 10 seconds, and
// concurrent pulls share one request.

describe("createPullLimiter", () => {
  test("a pull is shared for the interval from its start, then a new one runs", async () => {
    let now = 1_000_000;
    const limit = createPullLimiter<number>(10_000, () => now);
    let calls = 0;
    const pull = async () => {
      calls += 1;
      return calls;
    };

    assert.equal(await limit("s1", pull), 1);
    now += 9_999;
    assert.equal(await limit("s1", pull), 1, "still inside the 10 seconds");
    assert.equal(await limit("s2", pull), 2, "another store has its own window");
    now += 1;
    assert.equal(await limit("s1", pull), 3, "10 seconds after the first pull started");
    assert.equal(calls, 3);
  });

  test("calls made while a pull runs wait for it and get its result", async () => {
    const limit = createPullLimiter<string>(10_000, () => 0);
    let release: (value: string) => void = () => {};
    let calls = 0;
    const pull = () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };
    const first = limit("s1", pull);
    const second = limit("s1", pull);
    release("done");
    assert.deepEqual(await Promise.all([first, second]), ["done", "done"]);
    assert.equal(calls, 1);
  });
});
