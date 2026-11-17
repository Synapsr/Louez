import { db } from "@louez/db";

import { dispatchApiEffects } from "@/lib/api/effects";

import type { DepositHoldDeps } from "./deposit-hold";
import { stripeDepositHold } from "./deposit-hold-stripe";

/** What a deposit hold runs on in the app: the database, Stripe and the outbox. */
export const depositHoldDeps: DepositHoldDeps = {
  database: db,
  stripe: stripeDepositHold,
  dispatchEffects: dispatchApiEffects,
};
