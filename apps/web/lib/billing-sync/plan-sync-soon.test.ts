import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import type { LockedRun } from "./locks";
import { type PlanSyncOptions, type PlanSyncStep, syncPlanSoon } from "./plan-sync-soon";

// The early sync of a plan write (louez-billing docs/plans/plans-for-new-stores.md
// decision 8): a relay at once, then heartbeats at +10, +20, +30 and +45 seconds from
// the relay's start. Every step is a fake on a fake clock, except where a test says so;
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

/** The heartbeat fake's answer. */
const OK: PlanSyncStep = { outcome: "ok" };

/** Fakes for every step: the clock moves only when a step sleeps or a test moves it. */
function harness(overrides: Partial<PlanSyncOptions> = {}) {
  let at = 0;
  const events: string[] = [];
  const locks: string[] = [];
  const info: string[] = [];
  const warn: string[] = [];
  const tasks: Array<() => Promise<void>> = [];
  const cache: { version: number | null } = { version: 3 };
  const shutdown = new AbortController();
  const now = () => at;
  const options: PlanSyncOptions = {
    schedule: (task) => {
      tasks.push(task);
    },
    now,
    // An aborted sleep ends at once.
    sleep: async (ms, signal) => {
      if (!signal.aborted) at += ms;
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
      return OK;
    },
    lock: async <T>(task: string, run: () => Promise<T>): Promise<LockedRun<T>> => {
      locks.push(task);
      return { ran: true, value: await run() };
    },
    shutdown: shutdown.signal,
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
    shutdown,
    options,
    advance(ms: number) {
      at += ms;
    },
    /** Schedules the sync of `storeId` and runs what was scheduled, like `after`. */
    async sync(storeId: string) {
      syncPlanSoon(storeId, this.options);
      await this.runScheduled();
    },
    async runScheduled() {
      for (let task = tasks.shift(); task; task = tasks.shift()) await task();
    },
  };
}

/** A heartbeat fake that caches `versions[n]` on its nth call, from 0. */
function pulling(run: { events: string[]; now(): number; cache: { version: number | null } }) {
  return (versions: ReadonlyArray<number | null>) => {
    let beats = 0;
    return async () => {
      run.events.push(`heartbeat at ${run.now()}`);
      const version = versions[beats];
      beats += 1;
      if (version !== undefined && version !== null) run.cache.version = version;
      return OK;
    };
  };
}

const FOUR_HEARTBEATS = [
  "heartbeat at 10000",
  "heartbeat at 20000",
  "heartbeat at 30000",
  "heartbeat at 45000",
];

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

  test("relays at once, then runs all four heartbeats, at +10, +20, +30 and +45 seconds", async () => {
    const storeId = newStore();
    const run = harness();
    // The second heartbeat pulls the plan's version; the next two still run.
    run.options = { ...run.options, heartbeat: pulling(run)([null, 4]) };
    await run.sync(storeId);
    assert.deepEqual(run.events, ["relay at 0", ...FOUR_HEARTBEATS]);
    assert.deepEqual(run.locks, ["relay", "heartbeat", "heartbeat", "heartbeat", "heartbeat"]);
    assert.deepEqual(run.info, [
      `plan sync of store ${storeId}: policy v4 cached, 4 heartbeat(s), 45000 ms`,
    ]);
    assert.deepEqual(run.warn, []);
  });

  test("with no newer version cached, the line says the cron takes over", async () => {
    const storeId = newStore();
    const run = harness();
    await run.sync(storeId);
    assert.deepEqual(run.events, ["relay at 0", ...FOUR_HEARTBEATS]);
    assert.deepEqual(run.info, [
      `plan sync of store ${storeId}: no newer policy version cached, the cron takes over, 4 heartbeat(s), 45000 ms`,
    ]);
  });

  test("a store with no version of its own yet counts its first one", async () => {
    const run = harness();
    run.options = { ...run.options, heartbeat: pulling(run)([1]) };
    run.cache.version = null;
    await run.sync(newStore());
    assert.match(run.info[0] ?? "", /policy v1 cached, 4 heartbeat\(s\)/);
  });

  describe("a newer version that may not answer the plan", () => {
    test("cached while the relay waits for its lock, it ends nothing", async () => {
      const run = harness({
        lock: async <T>(task: string, work: () => Promise<T>) => {
          // The cron's heartbeat caches a staff change's v4 meanwhile.
          if (task === "relay") run.cache.version = 4;
          return { ran: true, value: await work() } satisfies LockedRun<T>;
        },
      });
      // The plan's v5 comes with the second heartbeat.
      run.options = { ...run.options, heartbeat: pulling(run)([null, 5]) };
      await run.sync(newStore());
      assert.deepEqual(run.events, ["relay at 0", ...FOUR_HEARTBEATS]);
      assert.match(run.info[0] ?? "", /policy v5 cached, 4 heartbeat\(s\), 45000 ms$/);
    });

    test("pulled by the sync's own first heartbeat, it ends nothing either", async () => {
      const run = harness();
      // A card's v4 comes with the first heartbeat, just before the plan job issues v5.
      run.options = { ...run.options, heartbeat: pulling(run)([4, 5]) };
      await run.sync(newStore());
      assert.deepEqual(run.events, ["relay at 0", ...FOUR_HEARTBEATS]);
      assert.match(run.info[0] ?? "", /policy v5 cached, 4 heartbeat\(s\)/);
    });
  });

  describe("locks", () => {
    test("a taken lock is tried every second, and the heartbeats count from the relay's start", async () => {
      const run = harness({
        lock: async <T>(task: string, work: () => Promise<T>) => {
          run.locks.push(`${task} at ${run.now()}`);
          // The cron's relay holds the lock for 7 seconds.
          if (task === "relay" && run.now() < 7000) return { ran: false } satisfies LockedRun<T>;
          return { ran: true, value: await work() } satisfies LockedRun<T>;
        },
      });
      await run.sync(newStore());
      assert.deepEqual(
        run.locks.filter((lock) => lock.startsWith("relay")),
        [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000].map((at) => `relay at ${at}`),
      );
      assert.deepEqual(run.events, [
        "relay at 7000",
        "heartbeat at 17000",
        "heartbeat at 27000",
        "heartbeat at 37000",
        "heartbeat at 52000",
      ]);
    });

    test("after a long relay, the first heartbeat runs at once", async () => {
      const run = harness({
        relay: async () => {
          run.events.push(`relay at ${run.now()}`);
          // A backlog: the relay runs to its time limit.
          run.advance(10_000);
          return { outcome: "ok", detail: null };
        },
      });
      await run.sync(newStore());
      assert.deepEqual(run.events, ["relay at 0", ...FOUR_HEARTBEATS]);
    });

    test("a relay lock taken for 25 seconds: no heartbeat, the cron sends the store", async () => {
      const storeId = newStore();
      const run = harness({
        lock: async <T>(task: string, work: () => Promise<T>) => {
          run.locks.push(task);
          if (task === "relay") return { ran: false } satisfies LockedRun<T>;
          return { ran: true, value: await work() } satisfies LockedRun<T>;
        },
      });
      await run.sync(storeId);
      assert.deepEqual(run.events, []);
      // From 0 to 25 seconds, a try each second.
      assert.deepEqual(run.locks, Array.from({ length: 26 }, () => "relay"));
      assert.deepEqual(run.info, [
        `plan sync of store ${storeId}: the relay lock stayed busy, the cron sends the store, 0 heartbeat(s), 25000 ms`,
      ]);
    });

    test("a heartbeat lock taken for 25 seconds skips that heartbeat only", async () => {
      let heartbeatTries = 0;
      const run = harness({
        lock: async <T>(task: string, work: () => Promise<T>) => {
          if (task === "heartbeat" && (heartbeatTries += 1) <= 26) {
            return { ran: false } satisfies LockedRun<T>;
          }
          return { ran: true, value: await work() } satisfies LockedRun<T>;
        },
      });
      await run.sync(newStore());
      // The first one tries from +10 to +35 seconds; the second and third are due by then.
      assert.deepEqual(run.events, [
        "relay at 0",
        "heartbeat at 35000",
        "heartbeat at 35000",
        "heartbeat at 45000",
      ]);
      assert.match(run.info[0] ?? "", /4 heartbeat\(s\), 45000 ms$/);
    });
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
      assert.deepEqual(run.locks, ["relay"]);
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
      assert.deepEqual(run.locks, ["relay", "heartbeat"]);
      assert.match(run.info[0] ?? "", /asked Louez to wait, 1 heartbeat\(s\)/);
    });
  });

  describe("a shutdown", () => {
    test("during the heartbeats stops the sync instead of waiting for the next one", async () => {
      const storeId = newStore();
      const run = harness();
      run.options = {
        ...run.options,
        heartbeat: async () => {
          run.events.push(`heartbeat at ${run.now()}`);
          run.shutdown.abort();
          return OK;
        },
      };
      await run.sync(storeId);
      assert.deepEqual(run.events, ["relay at 0", "heartbeat at 10000"]);
      assert.deepEqual(run.info, [
        `plan sync of store ${storeId}: stopped, the server is shutting down, the cron takes over, 1 heartbeat(s), 10000 ms`,
      ]);
    });

    test("wakes the default sleep, between heartbeats and between lock tries", async () => {
      // The real clock and sleep: the sync must end in milliseconds, not seconds.
      for (const busy of [false, true]) {
        const run = harness({ now: undefined, sleep: undefined });
        run.options = {
          ...run.options,
          relay: async () => ({ outcome: "ok", detail: null }),
          lock: async <T>(task: string, work: () => Promise<T>) =>
            busy && task === "relay"
              ? ({ ran: false } satisfies LockedRun<T>)
              : ({ ran: true, value: await work() } satisfies LockedRun<T>),
        };
        const startedAt = Date.now();
        setTimeout(() => run.shutdown.abort(), 50);
        await run.sync(newStore());
        assert.ok(Date.now() - startedAt < 2000, `busy ${busy}: ${Date.now() - startedAt} ms`);
        assert.match(run.info[0] ?? "", /stopped, the server is shutting down/, String(busy));
      }
    });
    test("leaves the queue for a step's turn, and starts no step once it holds the lock", async () => {
      // Two syncs hold the process's two places for locked steps, until `held` opens.
      const held = gate();
      const blockers = [harness(), harness()].map((blocker) => {
        blocker.options = {
          ...blocker.options,
          relay: async () => {
            await held.opened;
            return { outcome: "ok", detail: null };
          },
        };
        return blocker.sync(newStore());
      });
      await tick();

      const queued = harness();
      const storeId = newStore();
      const syncing = queued.sync(storeId);
      await tick();
      queued.shutdown.abort();
      const startedAt = Date.now();
      await syncing;
      assert.ok(Date.now() - startedAt < 1000, `${Date.now() - startedAt} ms`);
      assert.deepEqual(queued.locks, []);
      assert.deepEqual(queued.events, []);
      assert.match(queued.info[0] ?? "", /stopped, the server is shutting down/);
      held.open();
      await Promise.all(blockers);

      // The shutdown comes while the step takes its lock: the heartbeat does not start.
      const locked = harness();
      locked.options = {
        ...locked.options,
        lock: async <T>(task: string, work: () => Promise<T>): Promise<LockedRun<T>> => {
          locked.locks.push(task);
          if (task === "heartbeat") locked.shutdown.abort();
          return { ran: true, value: await work() };
        },
      };
      await locked.sync(newStore());
      assert.deepEqual(locked.locks, ["relay", "heartbeat"]);
      assert.deepEqual(locked.events, ["relay at 0"]);
      assert.match(locked.info[0] ?? "", /stopped, the server is shutting down, the cron takes over, 1 heartbeat\(s\)/);
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
      assert.deepEqual(beaten.locks, ["relay", "heartbeat"]);
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
    test("a call during the relay starts the next cycle right after it", async () => {
      const storeId = newStore();
      const relayGate = gate();
      let relays = 0;
      const run = harness({
        relay: async () => {
          relays += 1;
          run.events.push(`relay ${relays} at ${run.now()}`);
          if (relays === 1) await relayGate.opened;
          return { outcome: "ok", detail: null };
        },
      });
      run.options = { ...run.options, heartbeat: pulling(run)([4]) };
      syncPlanSoon(storeId, run.options);
      const going = run.tasks.shift()?.();
      await tick();
      assert.deepEqual(run.events, ["relay 1 at 0"]);

      // A second write while the first relay runs: its task ends at once.
      syncPlanSoon(storeId, run.options);
      await run.runScheduled();
      assert.deepEqual(run.events, ["relay 1 at 0"]);

      relayGate.open();
      await going;
      assert.deepEqual(run.events, ["relay 1 at 0", "relay 2 at 0", ...FOUR_HEARTBEATS]);
      assert.deepEqual(run.info, [
        `plan sync of store ${storeId}: another plan write came, the next relay sends it, 0 heartbeat(s), 0 ms`,
        `plan sync of store ${storeId}: policy v4 cached, 4 heartbeat(s), 45000 ms`,
      ]);
    });

    test("a call during the heartbeats relays at once, and that cycle may find no newer version", async () => {
      const storeId = newStore();
      let beats = 0;
      const run = harness();
      run.options = {
        ...run.options,
        heartbeat: async () => {
          run.events.push(`heartbeat at ${run.now()}`);
          beats += 1;
          if (beats === 1) {
            // The first heartbeat pulls the plan's version; then the plan changes again,
            // in a way that issues no version, such as a write racing the first one.
            run.cache.version = 4;
            syncPlanSoon(storeId, run.options);
            await run.runScheduled();
          }
          return OK;
        },
      };
      await run.sync(storeId);
      assert.deepEqual(run.events, [
        "relay at 0",
        "heartbeat at 10000",
        "relay at 10000",
        "heartbeat at 20000",
        "heartbeat at 30000",
        "heartbeat at 40000",
        "heartbeat at 55000",
      ]);
      assert.deepEqual(run.info, [
        `plan sync of store ${storeId}: another plan write came, the next relay sends it, 1 heartbeat(s), 10000 ms`,
        `plan sync of store ${storeId}: no newer policy version cached, the cron takes over, 4 heartbeat(s), 45000 ms`,
      ]);
    });

    test("a call wakes the default sleep, so the next relay does not wait for the heartbeat", async () => {
      // The real clock and sleep; the second cycle stops on a Retry-After at its relay.
      const storeId = newStore();
      let relays = 0;
      const run = harness({ now: undefined, sleep: undefined });
      run.options = {
        ...run.options,
        relay: async () => {
          relays += 1;
          run.events.push(`relay ${relays}`);
          if (relays === 1) {
            setTimeout(() => {
              syncPlanSoon(storeId, run.options);
              void run.runScheduled();
            }, 50);
            return { outcome: "ok", detail: null };
          }
          return { outcome: "waiting", detail: null };
        },
      };
      const startedAt = Date.now();
      await run.sync(storeId);
      assert.ok(Date.now() - startedAt < 2000, `${Date.now() - startedAt} ms`);
      assert.deepEqual(run.events, ["relay 1", "relay 2"]);
    });

    test("a call while the run waits for the relay lock is in that relay", async () => {
      const storeId = newStore();
      const lockGate = gate();
      const run = harness({
        lock: async <T>(task: string, work: () => Promise<T>) => {
          if (task === "relay") await lockGate.opened;
          return { ran: true, value: await work() } satisfies LockedRun<T>;
        },
      });
      syncPlanSoon(storeId, run.options);
      const going = run.tasks.shift()?.();
      await tick();
      syncPlanSoon(storeId, run.options);
      await run.runScheduled();

      lockGate.open();
      await going;
      assert.deepEqual(run.events, ["relay at 0", ...FOUR_HEARTBEATS]);
      assert.equal(run.info.length, 1);
    });

    test("other stores run at once, but at most two steps hold a connection at a time", async () => {
      const relayGate = gate();
      let holding = 0;
      let most = 0;
      const run = harness({
        lock: async <T>(_task: string, work: () => Promise<T>) => {
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
      });
      const stores = [newStore(), newStore(), newStore()];
      for (const storeId of stores) syncPlanSoon(storeId, run.options);
      const going = run.tasks.splice(0).map((task) => task());
      await tick();
      // The third store's relay waits for a turn.
      assert.deepEqual(run.events, ["relay", "relay"]);

      relayGate.open();
      await Promise.all(going);
      assert.deepEqual(
        run.events.filter((event) => event === "relay"),
        ["relay", "relay", "relay"],
      );
      assert.equal(run.info.length, 3);
      assert.equal(most, 2);
    });
  });
});
