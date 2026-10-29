import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import type { LockedRun } from "./locks";
import { type PlanSyncOptions, type PlanSyncStep, syncPlanSoon } from "./plan-sync-soon";

// The early sync of a plan write (louez-billing docs/plans/plans-for-new-stores.md
// decision 8): a relay at once, then heartbeats at +10, +20, +30 and +45 seconds until
// the store's newer policy version is cached. Every step is a fake on a fake clock;
// plan-sync-soon.db.test.ts runs the defaults against a database.

/** A promise the test resolves when it wants. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

let storeCount = 0;
/** A store id of its own per test: the runs going are counted per store, per process. */
const newStore = () => `ps_store_${(storeCount += 1)}`;

/** Fakes for every step: the clock moves only when a step sleeps or a test moves it. */
function harness(overrides: Partial<PlanSyncOptions> = {}) {
  let at = 0;
  const events: string[] = [];
  const locks: string[] = [];
  const info: string[] = [];
  const warn: string[] = [];
  const tasks: Array<() => Promise<void>> = [];
  const cache: { version: number | null } = { version: 3 };
  const now = () => at;
  const options: PlanSyncOptions = {
    schedule: (task) => {
      tasks.push(task);
    },
    now,
    sleep: async (ms) => {
      at += ms;
    },
    billsStore: async () => true,
    waitingForRetryAfter: async () => false,
    newestVersion: async () => cache.version,
    relay: async () => {
      events.push(`relay at ${now()}`);
      return { outcome: "ok", detail: null };
    },
    heartbeat: async () => {
      events.push(`heartbeat at ${now()}`);
      return { outcome: "ok" };
    },
    lock: async <T>(
      task: string,
      timeoutSeconds: number,
      run: () => Promise<T>,
    ): Promise<LockedRun<T>> => {
      locks.push(`${task} ${timeoutSeconds}`);
      return { ran: true, value: await run() };
    },
    log: {
      info: (_tag, message) => void info.push(message),
      warn: (_tag, message) => void warn.push(message),
    },
    ...overrides,
  };
  return {
    now,
    events,
    locks,
    info,
    warn,
    tasks,
    cache,
    options,
    advance(ms: number) {
      at += ms;
    },
    /** Schedules the sync of `storeId` and runs what was scheduled, like `after`. */
    async sync(storeId: string) {
      syncPlanSoon(storeId, options);
      await this.runScheduled();
    },
    async runScheduled() {
      for (let task = tasks.shift(); task; task = tasks.shift()) await task();
    },
  };
}

describe("syncPlanSoon", () => {
  test("does nothing for a store the billing service does not bill", async () => {
    const run = harness({ billsStore: async () => false });
    await run.sync(newStore());
    assert.deepEqual(run.events, []);
    assert.deepEqual([run.info, run.warn], [[], []]);
  });

  describe("with the sync off", () => {
    const saved = [process.env.LOUEZ_BILLING, process.env.BILLING_SERVICE_URL];
    afterEach(() => {
      const [billing, url] = saved;
      if (billing === undefined) delete process.env.LOUEZ_BILLING;
      else process.env.LOUEZ_BILLING = billing;
      if (url === undefined) delete process.env.BILLING_SERVICE_URL;
      else process.env.BILLING_SERVICE_URL = url;
    });

    test("does nothing, without reading the database", async () => {
      // The default test of who bills the store: no service URL is the sync off.
      process.env.LOUEZ_BILLING = "cloud";
      delete process.env.BILLING_SERVICE_URL;
      const run = harness({ billsStore: undefined });
      await run.sync(newStore());
      process.env.LOUEZ_BILLING = "off";
      process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
      await run.sync(newStore());
      assert.deepEqual(run.events, []);
      assert.deepEqual([run.info, run.warn], [[], []]);
    });
  });

  test("schedules the run, so nothing starts before the response", async () => {
    const run = harness();
    syncPlanSoon(newStore(), run.options);
    await tick();
    assert.deepEqual(run.events, []);
    assert.equal(run.tasks.length, 1);
    await run.runScheduled();
    assert.equal(run.events[0], "relay at 0");
  });

  test("relays at once, then runs heartbeats until a newer version is cached, then stops", async () => {
    const storeId = newStore();
    let beats = 0;
    const run = harness({
      heartbeat: async () => {
        run.events.push(`heartbeat at ${run.now()}`);
        beats += 1;
        // The second heartbeat pulls the plan's version.
        if (beats === 2) run.cache.version = 4;
        return { outcome: "ok" };
      },
    });
    await run.sync(storeId);
    assert.deepEqual(run.events, ["relay at 0", "heartbeat at 10000", "heartbeat at 20000"]);
    assert.deepEqual(run.locks, ["relay 25", "heartbeat 25", "heartbeat 25"]);
    assert.deepEqual(run.info, [
      `plan sync of store ${storeId}: policy v4 cached, 2 heartbeat(s), 20000 ms`,
    ]);
    assert.deepEqual(run.warn, []);
  });

  test("a store with no version of its own yet stops at its first one", async () => {
    const run = harness({
      heartbeat: async () => {
        run.cache.version = 1;
        return { outcome: "ok" };
      },
    });
    run.cache.version = null;
    await run.sync(newStore());
    assert.match(run.info[0] ?? "", /policy v1 cached, 1 heartbeat\(s\)/);
  });

  test("stops after four heartbeats, at +10, +20, +30 and +45 seconds, and leaves the rest to the cron", async () => {
    const storeId = newStore();
    const run = harness();
    await run.sync(storeId);
    assert.deepEqual(run.events, [
      "relay at 0",
      "heartbeat at 10000",
      "heartbeat at 20000",
      "heartbeat at 30000",
      "heartbeat at 45000",
    ]);
    assert.deepEqual(run.info, [
      `plan sync of store ${storeId}: no newer policy version cached yet, the cron takes over, 4 heartbeat(s), 45000 ms`,
    ]);
  });

  test("a version another heartbeat pulled stops the run without one of its own", async () => {
    const run = harness({
      // The cron's heartbeat caches the version 5 seconds after the relay.
      newestVersion: async () => (run.now() >= 5000 ? 4 : 3),
    });
    await run.sync(newStore());
    assert.deepEqual(run.events, ["relay at 0"]);
    assert.match(run.info[0] ?? "", /policy v4 cached, 0 heartbeat\(s\), 10000 ms/);
  });

  test("a version noted before the relay counts once cached while the relay waits for its lock", async () => {
    const run = harness({
      lock: async <T>(task: string, _seconds: number, work: () => Promise<T>) => {
        // The cron holds the relay lock; its heartbeat caches the version meanwhile.
        if (task === "relay") run.cache.version = 4;
        return { ran: true, value: await work() } satisfies LockedRun<T>;
      },
    });
    await run.sync(newStore());
    assert.deepEqual(run.events, ["relay at 0"]);
    assert.match(run.info[0] ?? "", /policy v4 cached, 0 heartbeat\(s\)/);
  });

  test("a busy lock is waited for, not skipped, and the heartbeats count from the relay's end", async () => {
    const run = harness({
      lock: async <T>(task: string, seconds: number, work: () => Promise<T>) => {
        run.locks.push(`${task} ${seconds}`);
        // The cron's relay holds the lock for 7 more seconds.
        if (task === "relay") run.advance(7000);
        return { ran: true, value: await work() } satisfies LockedRun<T>;
      },
      heartbeat: async () => {
        run.events.push(`heartbeat at ${run.now()}`);
        run.cache.version = 4;
        return { outcome: "ok" };
      },
    });
    await run.sync(newStore());
    assert.deepEqual(run.locks, ["relay 25", "heartbeat 25"]);
    assert.deepEqual(run.events, ["relay at 7000", "heartbeat at 17000"]);
  });

  test("a lock still busy after the wait skips that step only", async () => {
    const storeId = newStore();
    const run = harness({
      lock: async <T>(task: string, seconds: number, work: () => Promise<T>) => {
        run.locks.push(`${task} ${seconds}`);
        if (task === "relay") {
          run.advance(25_000);
          return { ran: false } satisfies LockedRun<T>;
        }
        return { ran: true, value: await work() } satisfies LockedRun<T>;
      },
    });
    await run.sync(storeId);
    // The relay that held the lock may have sent the store: the heartbeats still run.
    assert.deepEqual(run.events, [
      "heartbeat at 35000",
      "heartbeat at 45000",
      "heartbeat at 55000",
      "heartbeat at 70000",
    ]);
    assert.match(run.info[0] ?? "", /4 heartbeat\(s\), 70000 ms, the relay lock stayed busy$/);
  });

  describe("a Retry-After from the service", () => {
    test("before the run: nothing is sent and nothing is logged", async () => {
      const run = harness({ waitingForRetryAfter: async () => true });
      await run.sync(newStore());
      assert.deepEqual(run.events, []);
      assert.deepEqual([run.info, run.warn], [[], []]);
    });

    test("on the relay: no heartbeat", async () => {
      const storeId = newStore();
      const run = harness({ relay: async () => ({ outcome: "waiting", detail: null }) });
      await run.sync(storeId);
      assert.deepEqual(run.events, []);
      assert.deepEqual(run.locks, ["relay 25"]);
      assert.deepEqual(run.info, [
        `plan sync of store ${storeId}: stopped, the billing service asked Louez to wait, 0 heartbeat(s), 0 ms`,
      ]);
    });

    test("between heartbeats: no more of them", async () => {
      const run = harness({
        waitingForRetryAfter: async () => run.now() >= 20_000,
      });
      await run.sync(newStore());
      assert.deepEqual(run.events, ["relay at 0", "heartbeat at 10000"]);
      assert.match(run.info[0] ?? "", /asked Louez to wait, 1 heartbeat\(s\)/);
    });

    test("on a heartbeat: no more of them", async () => {
      const run = harness({ heartbeat: async () => ({ outcome: "waiting", detail: null }) });
      await run.sync(newStore());
      assert.deepEqual(run.locks, ["relay 25", "heartbeat 25"]);
      assert.match(run.info[0] ?? "", /asked Louez to wait, 1 heartbeat\(s\)/);
    });
  });

  describe("failures", () => {
    test("a relay that throws is logged as a warning, and the next call runs again", async () => {
      const storeId = newStore();
      let relays = 0;
      const run = harness({
        relay: async () => {
          relays += 1;
          if (relays === 1) throw new Error("the database is gone");
          return { outcome: "ok", detail: null };
        },
      });
      await run.sync(storeId);
      assert.deepEqual(run.warn, [
        `plan sync of store ${storeId}: failed: the database is gone, 0 heartbeat(s), 0 ms`,
      ]);
      await run.sync(storeId);
      assert.equal(relays, 2);
    });

    test("a relay or heartbeat that fails stops the run with a warning", async () => {
      const relayed = harness({
        relay: async (): Promise<PlanSyncStep> => ({
          outcome: "transport_failure",
          detail: "HTTP 503",
        }),
      });
      await relayed.sync(newStore());
      assert.deepEqual(relayed.events, []);
      assert.match(relayed.warn[0] ?? "", /stopped, the relay ended transport_failure: HTTP 503/);

      const beaten = harness({
        heartbeat: async () => ({ outcome: "failed", detail: "HTTP 500" }),
      });
      await beaten.sync(newStore());
      assert.deepEqual(beaten.locks, ["relay 25", "heartbeat 25"]);
      assert.match(beaten.warn[0] ?? "", /the heartbeat ended failed: HTTP 500, 1 heartbeat\(s\)/);
    });

    test("an error anywhere is swallowed, and so is `after` outside a request", async () => {
      const throwing = harness({
        billsStore: async () => {
          throw new Error("no policy");
        },
        heartbeat: async () => {
          throw new Error("unused");
        },
      });
      await throwing.sync(newStore());
      assert.match(throwing.warn[0] ?? "", /failed: no policy/);

      const heartbeatThrows = harness({
        heartbeat: async () => {
          throw new Error("socket hang up");
        },
      });
      await heartbeatThrows.sync(newStore());
      assert.match(heartbeatThrows.warn[0] ?? "", /failed: socket hang up, 1 heartbeat\(s\)/);

      assert.doesNotThrow(() =>
        syncPlanSoon(newStore(), {
          schedule: () => {
            throw new Error("`after` was called outside a request scope");
          },
        }),
      );
    });
  });

  describe("coalescing", () => {
    test("a call during the relay asks for one more cycle instead of a second run", async () => {
      const storeId = newStore();
      const relayGate = gate();
      let relays = 0;
      const run = harness({
        relay: async () => {
          relays += 1;
          run.events.push(`relay ${relays}`);
          if (relays === 1) await relayGate.opened;
          return { outcome: "ok", detail: null };
        },
        heartbeat: async () => {
          run.events.push("heartbeat");
          run.cache.version = (run.cache.version ?? 0) + 1;
          return { outcome: "ok" };
        },
      });
      syncPlanSoon(storeId, run.options);
      const first = run.tasks.shift();
      const going = first?.();
      await tick();
      assert.deepEqual(run.events, ["relay 1"]);

      // A second write while the first relay runs: its task ends at once.
      syncPlanSoon(storeId, run.options);
      await run.runScheduled();
      assert.deepEqual(run.events, ["relay 1"]);

      relayGate.open();
      await going;
      assert.deepEqual(run.events, ["relay 1", "heartbeat", "relay 2", "heartbeat"]);
      assert.equal(run.info.length, 2);
    });

    test("a call while the run waits for the relay lock is in that relay", async () => {
      const storeId = newStore();
      const lockGate = gate();
      const run = harness({
        lock: async <T>(task: string, _seconds: number, work: () => Promise<T>) => {
          if (task === "relay") await lockGate.opened;
          return { ran: true, value: await work() } satisfies LockedRun<T>;
        },
        heartbeat: async () => {
          run.events.push("heartbeat");
          run.cache.version = 4;
          return { outcome: "ok" };
        },
      });
      syncPlanSoon(storeId, run.options);
      const going = run.tasks.shift()?.();
      await tick();
      syncPlanSoon(storeId, run.options);
      await run.runScheduled();

      lockGate.open();
      await going;
      assert.deepEqual(run.events, ["relay at 0", "heartbeat"]);
    });

    test("other stores run at once, but at most two steps hold a connection at a time", async () => {
      const relayGate = gate();
      let holding = 0;
      let most = 0;
      const run = harness({
        lock: async <T>(_task: string, _seconds: number, work: () => Promise<T>) => {
          holding += 1;
          most = Math.max(most, holding);
          try {
            return { ran: true, value: await work() } satisfies LockedRun<T>;
          } finally {
            holding -= 1;
          }
        },
        relay: async () => {
          run.events.push("relay");
          await relayGate.opened;
          return { outcome: "ok", detail: null };
        },
        heartbeat: async () => {
          run.cache.version = 99;
          return { outcome: "ok" };
        },
      });
      const stores = [newStore(), newStore(), newStore()];
      for (const storeId of stores) syncPlanSoon(storeId, run.options);
      const going = run.tasks.splice(0).map((task) => task());
      await tick();
      // The third store's relay waits for a turn.
      assert.deepEqual(run.events, ["relay", "relay"]);

      relayGate.open();
      await Promise.all(going);
      assert.deepEqual(run.events, ["relay", "relay", "relay"]);
      assert.equal(most, 2);
    });
  });
});
