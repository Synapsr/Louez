/**
 * What the "needs a look" sample script writes, loaded by `needs-a-look.ts`
 * only once its guard (`checkSampleDatabase`) let it: nothing here is loaded,
 * and nothing connects to a database, before that. It connects on a pool of
 * its own, opened with the fields the guard checked (`openSampleDatabase`).
 */
import { randomBytes } from "node:crypto";

import { and, eq, or, sql } from "drizzle-orm";

import {
  apiEffects,
  customers,
  invoicePayments,
  invoices,
  paymentRefundOperations,
  payments,
  reservations,
  storeMembers,
  stores,
  users,
} from "@louez/db/schema";

import type { SampleConnection } from "./approvals-guard";
import { openSampleDatabase } from "./approvals-write";

const newId = () => randomBytes(16).toString("base64url").slice(0, 21);

/**
 * Past every date a worker waits for, within MySQL's TIMESTAMP range: the
 * sample refund stays claimed and its outbox row never falls due.
 */
const NEVER = new Date("2038-01-01T00:00:00Z");
/**
 * How long ago the sample credit note is owed: past the 90 days the cron arms a debt
 * again (`OWED_EFFECT_REARM_DAYS`, platform/effects.ts, not imported: it would load the
 * app's database module, which this script never uses). Its test checks the two agree.
 */
const SAMPLE_OWED_DAYS = 120;
/** Not a Stripe account: were the refund ever sent, Stripe would refuse it. */
const SAMPLE_ACCOUNT = "acct_louez_sample_inert";
const tag = () => randomBytes(3).toString("hex").toUpperCase();

function fail(message: string): never {
  console.error(`\x1b[31mERROR: ${message}\x1b[0m`);
  process.exit(1);
}

/**
 * Writes the samples in the store `storeRef` (its id or slug) for its owner
 * `email`, and prints the page's URL. Only `needs-a-look.ts` calls it, once
 * its guard let it.
 */
export async function writeSampleNeedsALook(
  connection: SampleConnection,
  email: string,
  storeRef: string,
) {
  const { pool, db } = openSampleDatabase(connection);
  try {
    await writeSamples(db, email, storeRef);
  } finally {
    await pool.end();
  }
}

async function writeSamples(
  db: ReturnType<typeof openSampleDatabase>["db"],
  email: string,
  storeRef: string,
) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) fail(`No user with the e-mail ${email}.`);
  const [store] = await db
    .select({
      id: stores.id,
      name: stores.name,
      settings: stores.settings,
    })
    .from(stores)
    .where(or(eq(stores.id, storeRef), eq(stores.slug, storeRef)))
    .limit(1);
  if (!store) fail(`No store with the id or slug ${storeRef}.`);
  const [member] = await db
    .select({ role: storeMembers.role })
    .from(storeMembers)
    .where(and(eq(storeMembers.storeId, store.id), eq(storeMembers.userId, user.id)));
  if (member?.role !== "owner") fail(`${email} is not an owner of “${store.name}”.`);

  const currency = (store.settings?.currency ?? "EUR").toUpperCase();
  const sample = tag();
  const customerId = newId();
  const reservationId = newId();
  const paymentId = newId();
  const chargeId = `ch_sample_${sample.toLowerCase()}`;
  const number = `SAMPLE-${sample}`;
  const now = Date.now();
  const days = (count: number) => new Date(now + count * 86_400_000);

  await db.insert(customers).values({
    id: customerId,
    storeId: store.id,
    email: `sample.${sample.toLowerCase()}@example.com`,
    firstName: "Camille",
    lastName: "Martin",
  });
  await db.insert(reservations).values({
    id: reservationId,
    storeId: store.id,
    customerId,
    number,
    status: "confirmed",
    startDate: days(7),
    endDate: days(9),
    subtotalAmount: "180.00",
    depositAmount: "0.00",
    totalAmount: "180.00",
    currency,
  });
  // Paid online: the payment the refunds below give back.
  await db.insert(payments).values({
    id: paymentId,
    reservationId,
    amount: "180.00",
    type: "rental",
    method: "stripe",
    status: "completed",
    stripePaymentIntentId: `pi_sample_${sample.toLowerCase()}`,
    stripeChargeId: chargeId,
    currency,
    grossMinor: 18_000,
  });

  // 1. A refund Stripe has not confirmed a day after it was asked (`refund_unconfirmed`).
  // Inert for every worker (stripe-refund.ts): claimed until NEVER, so the sender and
  // a reconciliation on read find it busy and call nobody; and an outbox row of its own
  // that is `failed` until NEVER, so the cron's pass sees it in flight and adds none,
  // and the outbox's retry never runs it.
  const operationId = newId();
  await db.insert(paymentRefundOperations).values({
    id: operationId,
    storeId: store.id,
    reservationId,
    paymentId,
    stripeAccountId: SAMPLE_ACCOUNT,
    stripeChargeId: chargeId,
    amountMinor: 4_000,
    currency,
    refundType: "rental",
    reason: "requested_by_customer",
    status: "requested",
    claimToken: "sample_never_sent_00",
    claimedUntil: NEVER,
    createdAt: sql`NOW() - INTERVAL 25 HOUR`,
  });
  await db.insert(apiEffects).values({
    id: newId(),
    storeId: store.id,
    reservationId,
    type: "payment.refund",
    payload: { operationId },
    status: "failed",
    attempts: 1,
    lastError: "sample data: never sent",
    nextAttemptAt: NEVER,
  });

  // 2. A Stripe refund that failed, its credit note standing (`refund_undone`).
  const failedRefundId = newId();
  await db.insert(payments).values({
    id: failedRefundId,
    reservationId,
    amount: "60.00",
    type: "rental",
    method: "stripe",
    status: "failed",
    stripeRefundId: `re_sample_${sample.toLowerCase()}`,
    refundOfPaymentId: paymentId,
    currency,
    grossMinor: 6_000,
    updatedAt: new Date(now - 60_000),
  });
  const creditNoteId = newId();
  await db.insert(invoices).values({
    id: creditNoteId,
    storeId: store.id,
    reservationId,
    customerId,
    type: "credit_note",
    kind: "credit_note",
    number: `AV-${number}`,
    issueDate: new Date(now).toISOString().slice(0, 10),
    currency,
    // A sample: no document is drawn for it.
    sellerSnapshot: {} as never,
    buyerSnapshot: {} as never,
    lines: [],
    vatBreakdown: [],
    totalExclTax: "-50.00",
    totalTax: "-10.00",
    totalInclTax: "-60.00",
    en16931Snapshot: {} as never,
    documentId: newId(),
    processingRule: "b2c",
  });
  await db
    .insert(invoicePayments)
    .values({ id: newId(), invoiceId: creditNoteId, paymentId: failedRefundId });

  // 3. A refund whose credit note the outbox gave up on (`credit_note_not_issued`).
  // Written as owed SAMPLE_OWED_DAYS ago, past OWED_EFFECT_REARM_DAYS: the cron never arms it again
  // (`rearmAbandonedEffects`), and an owed note is never pruned, so it stays as written.
  const refundId = newId();
  await db.insert(payments).values({
    id: refundId,
    reservationId,
    amount: "25.00",
    type: "rental",
    method: "cash",
    status: "completed",
    refundOfPaymentId: paymentId,
    currency,
  });
  await db.insert(apiEffects).values({
    id: newId(),
    storeId: store.id,
    reservationId,
    type: "payment.refundCreditNote",
    payload: {
      storeId: store.id,
      reservationId,
      paymentId,
      refundId,
      amount: "25.00",
      source: "sample",
    },
    status: "abandoned",
    attempts: 8,
    lastError: "The refund's credit note was not issued: sample data",
    nextAttemptAt: new Date(now),
    createdAt: new Date(now - SAMPLE_OWED_DAYS * 86_400_000),
  });

  // 4. A message to the customer that was not sent (`message_not_sent`). The outbox
  // never runs an abandoned message again (`retryDueEffects`): it stays unsent.
  await db.insert(apiEffects).values({
    id: newId(),
    storeId: store.id,
    reservationId,
    type: "reservation.customerMessage",
    payload: { channel: "email", notification: "customer_request_accepted" },
    status: "abandoned",
    attempts: 1,
    lastError: "Abandoned: recipient_changed: sample data",
    nextAttemptAt: new Date(now),
  });

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`
Sample items in “${store.name}” for ${email}, on booking #${number}:
  a refund not confirmed, a refund failed with credit note AV-${number},
  a credit note not issued, a message not sent.

  ${appUrl}/dashboard/inbox

Open it signed in as that owner, with “${store.name}” as the current store,
in 30 seconds (the inbox shows an item once it is 30 seconds old). “Mark as
handled” clears each one. No worker sends or re-runs any of them.`);
}
