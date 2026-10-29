import { after } from "next/server";

import { db, legacyBillingAppliesAt } from "@louez/db";

import { log as evlog } from "@/lib/evlog";

import { isBillingSyncEnabled } from "@/lib/billing-sync/config";
import { runHeartbeat } from "@/lib/billing-sync/heartbeat";
import { type LockedRun, createRunLimit, withBillingLock } from "@/lib/billing-sync/locks";
import { newestCachedStoreVersion } from "@/lib/billing-sync/policies";
import { runRelay } from "@/lib/billing-sync/relay";
import { isWaitingForRetryAfter, readSyncState } from "@/lib/billing-sync/state";

// A plan's start or end reaches the billing service, and the store's new policy version
// comes back, within seconds instead of minutes (louez-billing
// docs/plans/plans-for-new-stores.md decision 8, docs/api README Q47).
//
// Louez takes the fee at source from the cached policy version in force, and the
// service bills each payment by the version in force at its instant. Both agree because
// Louez has no rule of its own, such as "a plan row means no commission". On the cron
// alone, 1 to 3 minutes pass between the row write and the cached version: the next
// minute's relay, the service's plan job, then the next heartbeat. A payment in that
// window, such as the owner's test booking right after subscribing, still takes the
// commission, and the store owes it; at a plan's end it is the other way round. So
// after a write that starts, changes or ends the plan in force of a store the service
// bills (lockPlanInForce in lib/plan-limits.ts), Louez relays at once, then runs a few
// heartbeats. The cron stays the fallback for whatever this misses.
//
// The heartbeats all run, even once a newer version of the store is cached: the
// service also issues store versions for staff changes, cards and imports, and Louez
// cannot tell which one answers the plan. A heartbeat pulls the policies only when
// they changed, so the extra ones cost a request each.

/** How long a step tries its lock, where the cron tries once. */
const LOCK_WAIT_MS = 25_000;
/** How often a step tries a lock that is taken. Between tries it holds no connection. */
const LOCK_RETRY_MS = 1_000;
/**
 * The early relay's time limit. Store rows go first (selectDueRows in relay.ts), so the
 * store's row is in its first requests; the rest of a backlog is the cron's to send.
 */
const RELAY_LIMIT_MS = 10_000;
/**
 * When the heartbeats run, counted from the relay's start, when the store's row goes
 * out. The service's plan job runs every 10 seconds, so the version is usually cached
 * by the first or the second.
 */
const HEARTBEATS_AFTER_RELAY_MS = [10_000, 20_000, 30_000, 45_000] as const;
/**
 * At most this many steps of this process run under their lock at once, whatever the
 * number of stores. Each holds a pooled connection for its lock, and a heartbeat one
 * more for the manifests lock it may take inside (heartbeat.ts). One heartbeat runs at
 * a time across Louez, so the early sync holds at most three of the pool's ten, while
 * its steps run. A step that waits for its lock holds none.
 */
const LOCKED_STEPS_AT_ONCE = 2;

export type PlanSyncTask = "relay" | "heartbeat";

/** What a relay or heartbeat run answers: `ok`, or why it stopped. */
export type PlanSyncStep = { readonly outcome: string; readonly detail?: string | null };

export type PlanSyncLog = {
  info(tag: string, message: string): void;
  warn(tag: string, message: string): void;
};

export type PlanSyncOptions = {
  /** Runs the sync once the response is sent: `after` from next/server. */
  readonly schedule?: (task: () => Promise<void>) => void;
  readonly now?: () => number;
  /** Waits `ms`, or less once `signal` aborts. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Whether the sync is on and the billing service bills the store now. */
  readonly billsStore?: (storeId: string) => Promise<boolean>;
  /** Whether a `Retry-After` from the service has not passed. */
  readonly waitingForRetryAfter?: () => Promise<boolean>;
  /** The newest version of the store's own policy in the cache, null without one; for the log. */
  readonly newestVersion?: (storeId: string) => Promise<number | null>;
  readonly relay?: () => Promise<PlanSyncStep>;
  readonly heartbeat?: () => Promise<PlanSyncStep>;
  /** Runs `run` under the task's MySQL lock if it is free now, without waiting for it. */
  readonly lock?: <T>(task: PlanSyncTask, run: () => Promise<T>) => Promise<LockedRun<T>>;
  /** Aborts when the server shuts down: on SIGTERM by default. */
  readonly shutdown?: AbortSignal;
  readonly log?: PlanSyncLog;
};

type Steps = Required<Omit<PlanSyncOptions, "schedule">>;

/** A store's sync going in this process. */
type Run = {
  /** Whether a call came once the relay had started: its write may need one more cycle. */
  again: boolean;
  /** Aborted by that call, so the cycle's heartbeats make way for the next relay. */
  newer: AbortController;
};

const running = new Map<string, Run>();
const lockedSteps = createRunLimit(LOCKED_STEPS_AT_ONCE);

/**
 * Schedules the sync of one store's plan after the response, so the plan write has
 * committed by then. Call it once a write that started, changed or ended the plan in
 * force has committed. Never throws, and does nothing outside service mode or for a
 * store Louez's legacy code bills. Outside a request, as in a script, it does nothing
 * either: the cron brings the change within minutes, as before.
 */
export function syncPlanSoon(storeId: string, options: PlanSyncOptions = {}): void {
  const schedule = options.schedule ?? after;
  try {
    schedule(() => runPlanSync(storeId, options));
  } catch {
    // `after` outside a request scope.
  }
}

async function runPlanSync(storeId: string, options: PlanSyncOptions): Promise<void> {
  const going = running.get(storeId);
  if (going) {
    // A call that comes before the relay starts is in that relay (syncCycle).
    going.again = true;
    going.newer.abort();
    return;
  }
  const run: Run = { again: false, newer: new AbortController() };
  running.set(storeId, run);
  const steps = withDefaults(options);
  try {
    if (!(await steps.billsStore(storeId))) return;
    let again = true;
    while (again) again = (await syncCycle(storeId, steps, run)) && run.again;
  } catch (error) {
    steps.log.warn("billing", `plan sync of store ${storeId} failed: ${errorMessage(error)}`);
  } finally {
    running.delete(storeId);
  }
}

/**
 * One relay, then the heartbeats, unless another plan write of the store comes: then
 * the next cycle relays at once, and its heartbeats pull this cycle's version too. Logs
 * one line. False when the sync must stop: the service asked Louez to wait, the relay
 * did not run, a step failed, an error was thrown or the server is shutting down.
 */
async function syncCycle(storeId: string, steps: Steps, run: Run): Promise<boolean> {
  const startedAt = steps.now();
  let heartbeats = 0;
  const line = (outcome: string) =>
    `plan sync of store ${storeId}: ${outcome}, ${heartbeats} heartbeat(s), ${steps.now() - startedAt} ms`;
  const info = (outcome: string, going: boolean) => {
    steps.log.info("billing", line(outcome));
    return going;
  };
  const waited = () => info("stopped, the billing service asked Louez to wait", false);
  const failed = (step: string, result: PlanSyncStep) => {
    steps.log.warn(
      "billing",
      line(
        `stopped, the ${step} ended ${result.outcome}${result.detail ? `: ${result.detail}` : ""}`,
      ),
    );
    return false;
  };
  const shutDown = () => info("stopped, the server is shutting down, the cron takes over", false);

  try {
    if (await steps.waitingForRetryAfter()) return false;
    // For the closing line, noted before the relay: a version cached while it waits
    // for its lock counts as newer.
    const before = await steps.newestVersion(storeId);

    let relayStartedAt = 0;
    const relay = await underLock("relay", steps, () => {
      // A call from now on may hold a write this relay misses.
      run.again = false;
      run.newer = new AbortController();
      relayStartedAt = steps.now();
      return steps.relay();
    });
    if (steps.shutdown.aborted) return shutDown();
    // The cron's relay is sending a backlog. The store's row was marked after it
    // started, so it goes out in that run or the next, and the cron's heartbeats follow.
    if (!relay.ran) return info("the relay lock stayed busy, the cron sends the store", false);
    if (relay.value.outcome === "waiting") return waited();
    if (relay.value.outcome !== "ok") return failed("relay", relay.value);

    const wake = AbortSignal.any([run.newer.signal, steps.shutdown]);
    for (const delay of HEARTBEATS_AFTER_RELAY_MS) {
      const wait = relayStartedAt + delay - steps.now();
      if (wait > 0) await steps.sleep(wait, wake);
      if (steps.shutdown.aborted) return shutDown();
      if (run.again) return info("another plan write came, the next relay sends it", true);
      if (await steps.waitingForRetryAfter()) return waited();

      heartbeats += 1;
      const beat = await underLock("heartbeat", steps, steps.heartbeat);
      if (beat.ran && beat.value.outcome === "waiting") return waited();
      if (beat.ran && beat.value.outcome !== "ok") return failed("heartbeat", beat.value);
    }
    const newest = await steps.newestVersion(storeId);
    return info(
      newest !== null && (before === null || newest > before)
        ? `policy v${newest} cached`
        : "no newer policy version cached, the cron takes over",
      true,
    );
  } catch (error) {
    steps.log.warn("billing", line(`failed: ${errorMessage(error)}`));
    return false;
  }
}

/**
 * Runs `run` under the task's lock, trying it every LOCK_RETRY_MS for up to LOCK_WAIT_MS
 * in all, each try in its turn among this process's steps. Between tries it holds no
 * connection, and it stops trying once the server is shutting down.
 */
async function underLock<T>(
  task: PlanSyncTask,
  steps: Steps,
  run: () => Promise<T>,
): Promise<LockedRun<T>> {
  const deadline = steps.now() + LOCK_WAIT_MS;
  for (;;) {
    if (steps.shutdown.aborted) return { ran: false };
    const turn = await lockedSteps(Math.max(0, deadline - steps.now()), () =>
      steps.lock(task, run),
    );
    if (turn.ran && turn.value.ran) return turn.value;
    const wait = Math.min(LOCK_RETRY_MS, deadline - steps.now());
    if (!turn.ran || wait <= 0) return { ran: false };
    await steps.sleep(wait, steps.shutdown);
  }
}

function withDefaults(options: PlanSyncOptions): Steps {
  return {
    now: options.now ?? Date.now,
    sleep: options.sleep ?? sleepUnlessAborted,
    billsStore: options.billsStore ?? serviceBillsStoreNow,
    waitingForRetryAfter:
      options.waitingForRetryAfter ?? (async () => isWaitingForRetryAfter(await readSyncState())),
    newestVersion: options.newestVersion ?? ((storeId) => newestCachedStoreVersion(storeId)),
    // Its server errors leave single-event mode to the cron's runs (RelayOptions).
    relay:
      options.relay ??
      (() => runRelay({ timeLimitMs: RELAY_LIMIT_MS, countsServerErrors: false })),
    heartbeat: options.heartbeat ?? (() => runHeartbeat()),
    lock: options.lock ?? withBillingLock,
    shutdown: options.shutdown ?? serverShutdown(),
    log: options.log ?? evlog,
  };
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

let shutdown: AbortController | null = null;

/**
 * Aborts on SIGTERM, which a deploy sends. Next's server waits for the `after` work
 * before it exits, so a sync stops at once instead of holding it for its heartbeats,
 * and the cron takes over in the next process.
 */
function serverShutdown(): AbortSignal {
  if (!shutdown) {
    const controller = new AbortController();
    shutdown = controller;
    process.once("SIGTERM", () => {
      controller.abort();
      // A listener alone keeps the process alive on SIGTERM: give it back its default.
      if (process.listenerCount("SIGTERM") === 0) process.kill(process.pid, "SIGTERM");
    });
  }
  return shutdown.signal;
}

/**
 * The plan webhooks' test of who bills the store (serviceBillsNow in
 * lib/stripe/subscription-webhooks.ts), in service mode only: outside it,
 * legacyBillingAppliesAt answers for the instance, not the store.
 */
async function serviceBillsStoreNow(storeId: string): Promise<boolean> {
  return isBillingSyncEnabled() && !(await legacyBillingAppliesAt(db, storeId, new Date()));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
