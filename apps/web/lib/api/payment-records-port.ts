import { nanoid } from "nanoid";

import type { PaymentRecordsPort } from "@louez/api";

import { insertRecordedPayment } from "@/lib/reservations/dashboard-payment-writes";

/**
 * The dashboard's writer of a payment the store records by hand, lent to the
 * payment procedures (packages/api services/payment-records.ts): its billing
 * facts are the app's. The payment's id is made here.
 */
export const paymentRecordsPort: PaymentRecordsPort = {
  insert: (tx, payment) => insertRecordedPayment(tx, { ...payment, id: nanoid() }),
};
