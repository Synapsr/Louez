import type { ApiEffectSenders } from "@louez/api/platform/effects";

import { recordSmsDelivery } from "./delivery-record";

/**
 * The sender of `sms.deliveryRecord` (lib/sms/delivery.ts): writes the record
 * of an SMS that already went out, once. It sends nothing; it throws while the
 * database refuses, so the outbox tries again.
 */
export function createSmsEffectSenders(
  deps: { recordSmsDelivery: typeof recordSmsDelivery } = { recordSmsDelivery },
): Pick<ApiEffectSenders, "sms.deliveryRecord"> {
  return {
    "sms.deliveryRecord": async (payload, context) => {
      await context.assertClaim();
      await deps.recordSmsDelivery(payload);
    },
  };
}
