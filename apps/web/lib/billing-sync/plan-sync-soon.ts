import { after } from "next/server";

import { db, legacyBillingAppliesAt } from "@louez/db";

import { log as evlog } from "@/lib/evlog";

import { isBillingSyncEnabled } from "@/lib/billing-sync/config";
import { runHeartbeat } from "@/lib/billing-sync/heartbeat";
import {
  type LockedRun,
  billingLockName,
  createRunLimit,
  withNamedLock,
} from "@/lib/billing-sync/locks";
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
// after a plan write of a store the service bills, Louez relays at once, then runs a
// few heartbeats until the store's newer version is cached. The cron stays the
// fallback for whatever this misses.

/** How long a step waits for its turn and its lock, where the cron skips at once. */
const LOCK_WAIT_MS = 25_000;
/**
 * When the heartbeats run, counted from the relay's end. The service's plan job runs
 * every 10 seconds, so the version is usually cached by the first or second one.
 */
const HEARTBEATS_AFTER_RELAY_MS = [10_000, 20_000, 30_000, 45_000] as const;
/**
 * At most this many steps of this process hold a pooled connection at once, waiting for
 * a lock or under it, whatever the number of stores: a burst of webhooks leaves the rest
 * of the pool to the app.
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
  readonly sleep?: (ms: number) => Promise<void>;
  /** Whether the sync is on and the billing service bills the store now. */
  readonly billsStore?: (storeId: string) => Promise<boolean>;
  /** Whether a `Retry-After` from the service has not passed. */
  readonly waitingForRetryAfter?: () => Promise<boolean>;
  /** The newest version of the store's own policy in the cache, null without one. */
  readonly newestVersion?: (storeId: string) => Promise<number | null>;
  readonly relay?: () => Promise<PlanSyncStep>;
  readonly heartbeat?: () => Promise<PlanSyncStep>;
  /** Runs `run` under the task's MySQL lock, waiting up to `timeoutSeconds` for it. */
  readonly lock?: <T>(
    task: PlanSyncTask,
    timeoutSeconds: number,
    run: () => Promise<T>,
  ) => Promise<LockedRun<T>>;
  readonly log?: PlanSyncLog;
};

type Steps = Required<Omit<PlanSyncOptions, "schedule">>;

/** The stores with a sync going in this process, and whether a call asked for one more cycle. */
const running = new Map<string, { again: boolean }>();
const lockedSteps = createRunLimit(LOCKED_STEPS_AT_ONCE);

/**
 * Schedules the sync of one store's plan after the response, so the plan write has
 * committed by then. Call it once the write that marks the store's row is done. Never
 * throws, and does nothing outside service mode or for a store Louez's legacy code
 * bills. Outside a request, as in a script, it does nothing either: the cron brings
 * the change within minutes, as before.
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
    going.again = true;
    return;
  }
  const run = { again: false };
  running.set(storeId, run);
  const steps = withDefaults(options);
  try {
    if (!(await steps.billsStore(storeId))) return;
    // A call that comes once the relay has started may hold a write that relay missed:
    // one more cycle. A call that came before is in that relay.
    const relayStarts = () => {
      run.again = false;
    };
    let again = true;
    while (again) again = (await syncCycle(storeId, steps, relayStarts)) && run.again;
  } catch (error) {
    steps.log.warn("billing", `plan sync of store ${storeId} failed: ${errorMessage(error)}`);
  } finally {
    running.delete(storeId);
  }
}

/**
 * One relay, then heartbeats until the store's newer version is cached or the last one
 * has run. Logs one line. False when the sync must stop: the service asked Louez to
 * wait, a step failed, or an error was thrown.
 */
async function syncCycle(storeId: string, steps: Steps, relayStarts: () => void): Promise<boolean> {
  const startedAt = steps.now();
  let heartbeats = 0;
  let relayLocked = true;
  const line = (outcome: string) =>
    `plan sync of store ${storeId}: ${outcome}, ${heartbeats} heartbeat(s), ${steps.now() - startedAt} ms${relayLocked ? "" : ", the relay lock stayed busy"}`;
  const waited = () => {
    steps.log.info("billing", line("stopped, the billing service asked Louez to wait"));
    return false;
  };
  const failed = (step: string, result: PlanSyncStep) => {
    steps.log.warn(
      "billing",
      line(
        `stopped, the ${step} ended ${result.outcome}${result.detail ? `: ${result.detail}` : ""}`,
      ),
    );
    return false;
  };

  try {
    if (await steps.waitingForRetryAfter()) return false;
    // Noted before the relay, so a version cached while it waits for its lock counts.
    const before = await steps.newestVersion(storeId);
    const newer = async () => {
      const newest = await steps.newestVersion(storeId);
      return newest !== null && (before === null || newest > before) ? newest : null;
    };
    const arrived = (version: number) => {
      steps.log.info("billing", line(`policy v${version} cached`));
      return true;
    };

    const relay = await underLock("relay", steps, () => {
      relayStarts();
      return steps.relay();
    });
    relayLocked = relay.ran;
    if (relay.ran && relay.value.outcome === "waiting") return waited();
    if (relay.ran && relay.value.outcome !== "ok") return failed("relay", relay.value);

    const relayedAt = steps.now();
    for (const delay of HEARTBEATS_AFTER_RELAY_MS) {
      const wait = relayedAt + delay - steps.now();
      if (wait > 0) await steps.sleep(wait);
      // Another heartbeat, the cron's or another store's, may have pulled it.
      const cached = await newer();
      if (cached !== null) return arrived(cached);
      if (await steps.waitingForRetryAfter()) return waited();

      heartbeats += 1;
      const beat = await underLock("heartbeat", steps, steps.heartbeat);
      if (beat.ran && beat.value.outcome === "waiting") return waited();
      if (beat.ran && beat.value.outcome !== "ok") return failed("heartbeat", beat.value);
      const pulled = await newer();
      if (pulled !== null) return arrived(pulled);
    }
    steps.log.info("billing", line("no newer policy version cached yet, the cron takes over"));
    return true;
  } catch (error) {
    steps.log.warn("billing", line(`failed: ${errorMessage(error)}`));
    return false;
  }
}

/** Waits up to LOCK_WAIT_MS in all for a turn among this process's steps, then for the lock. */
async function underLock<T>(
  task: PlanSyncTask,
  steps: Steps,
  run: () => Promise<T>,
): Promise<LockedRun<T>> {
  const deadline = steps.now() + LOCK_WAIT_MS;
  const turn = await lockedSteps(LOCK_WAIT_MS, () =>
    steps.lock(task, Math.max(0, Math.floor((deadline - steps.now()) / 1000)), run),
  );
  return turn.ran ? turn.value : { ran: false };
}

function withDefaults(options: PlanSyncOptions): Steps {
  return {
    now: options.now ?? Date.now,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    billsStore: options.billsStore ?? serviceBillsStoreNow,
    waitingForRetryAfter:
      options.waitingForRetryAfter ?? (async () => isWaitingForRetryAfter(await readSyncState())),
    newestVersion: options.newestVersion ?? ((storeId) => newestCachedStoreVersion(storeId)),
    relay: options.relay ?? (() => runRelay()),
    heartbeat: options.heartbeat ?? (() => runHeartbeat()),
    lock:
      options.lock ??
      ((task, timeoutSeconds, run) => withNamedLock(billingLockName(task), timeoutSeconds, run)),
    log: options.log ?? evlog,
  };
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
