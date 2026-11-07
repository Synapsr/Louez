import assert from "node:assert/strict";
import { test } from "node:test";

import { deadlockRetryDelayMs, retryTransactionOnDeadlock } from "./deadlock";

const deadlock = () => Object.assign(new Error("Deadlock found"), { errno: 1213 });

test("a lost deadlock runs again after a short, growing, random wait", async () => {
  const waits: number[] = [];
  let runs = 0;
  const result = await retryTransactionOnDeadlock(
    async () => {
      runs += 1;
      if (runs < 3) throw deadlock();
      return "done";
    },
    { sleep: async (ms) => void waits.push(ms) },
  );
  assert.equal(result, "done");
  assert.equal(runs, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits[0] >= 20 && waits[0] <= 80, `first wait ${waits[0]}`);
  assert.ok(waits[1] >= 40 && waits[1] <= 160, `second wait ${waits[1]}`);
});

test("the waits stay within their bounds, well under a second in all", () => {
  assert.equal(
    deadlockRetryDelayMs(1, () => 0),
    20,
  );
  assert.equal(
    deadlockRetryDelayMs(1, () => 1),
    80,
  );
  assert.equal(
    deadlockRetryDelayMs(2, () => 0),
    40,
  );
  assert.equal(
    deadlockRetryDelayMs(2, () => 1),
    160,
  );
});

test("past the last run, or for another error, it gives up without waiting", async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => void waits.push(ms);
  let runs = 0;
  await assert.rejects(
    retryTransactionOnDeadlock(
      async () => {
        runs += 1;
        throw deadlock();
      },
      { sleep },
    ),
    /Deadlock found/,
  );
  assert.equal(runs, 3);
  assert.equal(waits.length, 2);

  await assert.rejects(
    retryTransactionOnDeadlock(
      async () => {
        throw new Error("not a deadlock");
      },
      { sleep },
    ),
    /not a deadlock/,
  );
  assert.equal(waits.length, 2, "no wait for an error it does not retry");
});
