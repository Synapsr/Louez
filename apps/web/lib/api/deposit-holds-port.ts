import type { DepositHoldsPort } from "@louez/api/platform/ports";

import { resolveUnconfirmedAttempt } from "@/lib/reservations/deposit-hold";
import { depositHoldDeps } from "@/lib/reservations/deposit-hold-live";

/**
 * The store's deposit holds, lent to the agent-ready API (packages/api
 * platform/ports.ts) until the deposit hold moves into the package: the same code the
 * dashboard's and the webhook's paths run, on the app's database, Stripe and outbox.
 */
export const depositHoldsPort: DepositHoldsPort = {
  resolveUnconfirmedAttempt: (input) => resolveUnconfirmedAttempt(input, depositHoldDeps),
};
