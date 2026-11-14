import { nanoid } from "nanoid";

import type { PaymentRecordsPort } from "@louez/api";

import {
  insertRecordedPaymentWithFacts,
  recordedPaymentFactsOf,
} from "@/lib/reservations/dashboard-payment-writes";

/**
 * The dashboard's writer of a payment the store records by hand, lent to the
 * payment procedures (packages/api services/payment-records.ts): its billing
 * facts are the app's, computed under the reservation's lock (`facts`), bound
 * by the procedure, then written as they are (`insert`). The payment's id is
 * made here.
 */
export const paymentRecordsPort: PaymentRecordsPort = {
  facts: (tx, draft) => recordedPaymentFactsOf(tx, draft),
  insert: (tx, payment) => insertRecordedPaymentWithFacts(tx, { ...payment, id: nanoid() }),
};
