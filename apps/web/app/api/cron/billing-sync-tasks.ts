import { runHeartbeat } from "@/lib/billing-sync/heartbeat";
import { withBillingLock } from "@/lib/billing-sync/locks";
import { runManifests } from "@/lib/billing-sync/manifests";
import { runRelay } from "@/lib/billing-sync/relay";
import { runSweep } from "@/lib/billing-sync/sweep";

import type { IsolatedTask } from "./isolated-tasks";

/**
 * The billing service sync, on every cron call: the relay, then the heartbeat, the
 * manifests and the sweep. Each one decides itself whether it is due, so a sweep
 * missed at 02:00 UTC still runs later that day (`isSweepDue`). Each holds its MySQL
 * lock, so a call that overlaps the previous minute's skips it.
 */
export function billingSyncTasks(now: Date): IsolatedTask[] {
  return [
    {
      task: "billing-relay",
      key: "billingRelay",
      run: () => withBillingLock("relay", () => runRelay()),
    },
    {
      task: "billing-heartbeat",
      key: "billingHeartbeat",
      run: () => withBillingLock("heartbeat", () => runHeartbeat()),
    },
    {
      task: "billing-manifests",
      key: "billingManifests",
      run: () => withBillingLock("manifests", () => runManifests(now)),
    },
    {
      task: "billing-sweep",
      key: "billingSweep",
      run: () => withBillingLock("sweep", () => runSweep(now)),
    },
  ];
}
