import type { ApiEffectSenders } from "@louez/api/platform/effects";
import { db } from "@louez/db";

import { type DepositHoldDeps, releaseOwedHold } from "./deposit-hold";
import { stripeDepositHold } from "./deposit-hold-stripe";

/**
 * The sender of `deposit.holdRelease` (lib/reservations/deposit-hold.ts): cancels at
 * Stripe an authorization Louez decided against, and records Stripe's answer. It
 * sends nothing; it throws while Stripe has not released the authorization, so the
 * outbox tries again, and gives up after its attempts: the inbox then shows the hold
 * (`deposit_release_failed`).
 */
export function createDepositHoldEffectSenders(
  deps: Pick<DepositHoldDeps, "database" | "stripe"> = { database: db, stripe: stripeDepositHold },
): Pick<ApiEffectSenders, "deposit.holdRelease"> {
  return {
    "deposit.holdRelease": (payload, context) =>
      releaseOwedHold(deps, payload, () => context.assertClaim()),
  };
}
