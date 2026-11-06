import { log } from "@/lib/evlog";

import type { CustomerMessage } from "./util.customer-message-channel";

/**
 * An automatic message skipped on purpose: the customer has no e-mail and the
 * message has no SMS version (or SMS is off). Logged so support can tell a
 * silent skip from a failed send.
 */
export const logCustomerMessageSkipped = (details: {
  message: CustomerMessage;
  storeId: string;
  reservationId: string;
  customerId: string;
}): void => {
  log.info({ customerMessage: { event: "skipped_unreachable", ...details } });
};
