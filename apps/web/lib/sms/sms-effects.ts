import type { ApiEffectSenders } from "@louez/api/platform/effects";

import { takePrepaidSmsCredit } from "./delivery-record";

/**
 * The sender of `sms.prepaidDebit` (lib/sms/delivery.ts): takes the prepaid
 * credit of an SMS that already went out, once. It sends nothing; it throws
 * while the database refuses, so the outbox tries again.
 */
export function createSmsEffectSenders(
  deps: { takePrepaidSmsCredit: typeof takePrepaidSmsCredit } = { takePrepaidSmsCredit },
): Pick<ApiEffectSenders, "sms.prepaidDebit"> {
  return {
    "sms.prepaidDebit": async (payload, context) => {
      await context.assertClaim();
      await deps.takePrepaidSmsCredit(payload.recordId, payload.storeId);
    },
  };
}
