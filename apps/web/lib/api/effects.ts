import { after } from "next/server";

import {
  dispatchEffects,
  pruneEffects,
  retryDueEffects,
  type ApiEffectSenders,
} from "@louez/api/platform/effects";

import { reportServerError } from "@/lib/error-tracking";
import { log } from "@/lib/evlog";
import { createReservationEffectSenders } from "@/lib/reservations/status-change-effects";
import { createStoreCreationEffectSenders } from "@/lib/stores/store-creation-effects";
import { createStoreLaunchEffectSenders } from "@/lib/stores/store-launch-effects";
import { createStoreSetupEffectSenders } from "@/lib/stores/store-setup-effects";
import { createTeamInvitationEffectSenders } from "@/lib/team/team-invitation-effects";

/**
 * The app's senders of the outbox rows (packages/api platform/effects.ts), by
 * effect type. A domain that adds an effect type adds its sender here.
 */
export const apiEffectSenders: ApiEffectSenders = {
  ...createReservationEffectSenders(),
  ...createStoreCreationEffectSenders(),
  ...createStoreLaunchEffectSenders(),
  ...createStoreSetupEffectSenders(),
  ...createTeamInvitationEffectSenders(),
};

/**
 * `ApiPorts.dispatchEffects`: sends a committed write's rows once the answer
 * is sent. A row that fails stays for the cron (`retryDueApiEffects`). Never
 * throws.
 */
export function dispatchApiEffects(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const run = () =>
    dispatchEffects(ids, apiEffectSenders).catch((error: unknown) => {
      log.error({ apiEffects: { event: "dispatch_failed", ids, error: String(error) } });
      reportServerError(error, { source: "effects" });
    });
  try {
    after(run);
  } catch {
    // Outside a request (a script): run it now, without waiting.
    void run();
  }
}

/**
 * The cron's pass over the outbox: due retries, rows never taken, expired
 * claims, each claimed at the time it is taken; then the done rows past
 * their 30 days, which hold personal data.
 */
export async function runApiEffectsCron() {
  const retried = await retryDueEffects(apiEffectSenders);
  const pruned = await pruneEffects();
  return { ...retried, pruned };
}
