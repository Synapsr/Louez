import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import type { ApiEffectSenders } from "@louez/api/platform/effects";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// What a refund still owes, as the store's inbox shows it, on a migrated database: a
// refund of an online payment Stripe has not confirmed a day after it was asked
// (`refund_unconfirmed`), a recorded refund Stripe then reported failed whose credit
// note or fee Louez cannot undo by itself (`refund_undone`), and a refund's credit
// note the outbox gave up on (`credit_note_not_issued`), which the cron arms again
// once a day until it is issued.

// The API's modules import these shared packages by name; loaded through require.
for (const name of [
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
  "@louez/types",
]) {
  mock.module(name, { namedExports: createRequire(import.meta.url)(name) });
}

const STORE = "store_refund_inbox";

describe("refunds in the inbox (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let inbox: typeof import("@louez/api/services/inbox");
  let outbox: typeof import("@louez/api/platform/effects");
  let testUrls: typeof import("@louez/api/platform/test-urls");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("refund_inbox");
    louezDb = await import("@louez/db");
    inbox = await import("@louez/api/services/inbox");
    outbox = await import("@louez/api/platform/effects");
    testUrls = await import("@louez/api/platform/test-urls");
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Refund inbox",
      slug: "refund-inbox",
      stripeAccountId: "acct_refund_inbox",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  async function items(type: string) {
    const [store] = await louezDb.db
      .select()
      .from(louezDb.stores)
      .where(eq(louezDb.stores.id, STORE));
    assert.ok(store);
    const { items: all } = await inbox.listInbox(
      {
        store,
        urls: testUrls.createTestUrls(),
        hostedBy: null,
        reads: { reservations: true, payments: true },
        operationsOf: null,
      },
      {},
    );
    return all.filter((item) => item.type === type);
  }

  /** A reservation with a Stripe payment of 100.00. */
  async function paid() {
    const n = ++counter;
    const reservationId = `res_inbox_${n}`;
    const paymentId = `pay_inbox_${n}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId: STORE,
      customerId: "customer",
      number: `R-${n}`,
      status: "confirmed",
      startDate: new Date("2026-10-01T09:00:00Z"),
      endDate: new Date("2026-10-03T09:00:00Z"),
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
      currency: "EUR",
    });
    await louezDb.db.insert(louezDb.payments).values({
      id: paymentId,
      reservationId,
      amount: "100.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      stripePaymentIntentId: `pi_inbox_${n}`,
      stripeChargeId: `ch_inbox_${n}`,
      currency: "EUR",
      grossMinor: 10_000,
    });
    return { reservationId, paymentId, n };
  }

  test("a refund operation still open a day after it was asked is shown until it is settled", async () => {
    const { reservationId, paymentId, n } = await paid();
    const operation = (status: "requested" | "unresolved", hours: number, id: string) =>
      louezDb.db.insert(louezDb.paymentRefundOperations).values({
        id,
        storeId: STORE,
        reservationId,
        paymentId,
        stripeAccountId: "acct_refund_inbox",
        stripeChargeId: `ch_inbox_${n}`,
        amountMinor: 3_000,
        currency: "EUR",
        refundType: "rental",
        reason: "requested_by_customer",
        status,
        createdAt: sql`NOW() - INTERVAL ${hours * 60} MINUTE`,
      });
    await operation("unresolved", 25, `op_old_${n}`);
    await operation("requested", 2, `op_new_${n}`);

    const shown = await items("refund_unconfirmed");
    assert.deepEqual(
      shown.map((item) => item.details?.operationId),
      [`op_old_${n}`],
    );
    assert.equal(shown[0]?.details?.amount, "30.00");

    await louezDb.db
      .update(louezDb.paymentRefundOperations)
      .set({ status: "succeeded" })
      .where(eq(louezDb.paymentRefundOperations.id, `op_old_${n}`));
    assert.deepEqual(await items("refund_unconfirmed"), []);
  });

  test("an undone refund is shown with the credit note to correct and the fee given back on it", async () => {
    const { reservationId, paymentId, n } = await paid();
    const refundRow = (id: string, status: "failed" | "completed") =>
      louezDb.db.insert(louezDb.payments).values({
        id,
        reservationId,
        amount: "60.00",
        type: "rental",
        method: "stripe",
        status,
        stripeRefundId: `re_${id}`,
        refundOfPaymentId: paymentId,
        currency: "EUR",
        grossMinor: 6_000,
        // As the writer marks it, on the app's clock.
        updatedAt: new Date(Date.now() - 60_000),
      });
    await refundRow(`ref_noted_${n}`, "failed");
    await refundRow(`ref_fee_${n}`, "failed");
    await refundRow(`ref_plain_${n}`, "failed");
    await refundRow(`ref_live_${n}`, "completed");
    // A credit note issued for the first, as invoicing links one.
    await louezDb.db.insert(louezDb.invoices).values({
      id: `inv_${n}`,
      storeId: STORE,
      reservationId,
      customerId: "customer",
      type: "credit_note",
      kind: "credit_note",
      number: `AV-${n}`,
      issueDate: "2026-10-02",
      currency: "EUR",
      sellerSnapshot: {} as never,
      buyerSnapshot: {} as never,
      lines: [],
      vatBreakdown: [],
      totalExclTax: "-50.00",
      totalTax: "-10.00",
      totalInclTax: "-60.00",
      en16931Snapshot: {} as never,
      documentId: `doc_${n}`,
      processingRule: "b2c",
    });
    for (const refundId of [`ref_noted_${n}`, `ref_live_${n}`]) {
      await louezDb.db.insert(louezDb.invoicePayments).values({
        id: `ip_${refundId}`,
        invoiceId: `inv_${n}`,
        paymentId: refundId,
      });
    }
    await louezDb.db.insert(louezDb.reservationActivity).values({
      id: `act_fee_${n}`,
      reservationId,
      activityType: "payment_updated",
      metadata: {
        kind: "refund_fee_over_returned",
        paymentId: `ref_fee_${n}`,
        feeId: "fee_inbox",
        overReturnedMinor: 180,
      },
    });

    const shown = await items("refund_undone");
    assert.deepEqual(
      shown
        .map((item) => [
          item.details?.refundPaymentId,
          item.details?.creditNoteNumber,
          item.details?.feeOverReturned,
        ])
        .sort(),
      [
        [`ref_fee_${n}`, null, "1.80"],
        [`ref_noted_${n}`, `AV-${n}`, null],
      ],
    );
  });

  test("a credit note the outbox gave up on is shown, armed again a day later, once, and leaves once issued", async () => {
    const { reservationId, paymentId, n } = await paid();
    await louezDb.db.insert(louezDb.payments).values({
      id: `ref_note_${n}`,
      reservationId,
      amount: "25.00",
      type: "rental",
      method: "cash",
      status: "completed",
      refundOfPaymentId: paymentId,
      currency: "EUR",
    });
    const [effectId] = await louezDb.db.transaction((tx) =>
      outbox.enqueueEffects(tx, STORE, [
        {
          type: "payment.refundCreditNote",
          reservationId,
          payload: {
            storeId: STORE,
            reservationId,
            paymentId,
            refundId: `ref_note_${n}`,
            amount: "25.00",
            source: "test",
          },
        },
      ]),
    );
    assert.ok(effectId);
    const giveUp = (hoursAgo: number) =>
      louezDb.db.execute(sql`
        UPDATE api_effects
        SET status = 'abandoned', attempts = 8, last_error = 'invoicing unavailable',
            next_attempt_at = NOW() - INTERVAL ${hoursAgo * 60} MINUTE
        WHERE id = ${effectId}`);
    const rowOf = async () => (await outbox.readEffects([effectId]))[0];

    // Given up an hour ago: shown, and not armed yet.
    await giveUp(1);
    const shown = await items("credit_note_not_issued");
    assert.deepEqual(
      shown.map((item) => [item.details?.reservationNumber, item.details?.amount]),
      [[`R-${n}`, "25.00"]],
    );
    assert.deepEqual(await outbox.rearmAbandonedEffects(), []);

    // A day later: armed again, once, even by two passes.
    await giveUp(25);
    assert.deepEqual(await outbox.rearmAbandonedEffects(), [effectId]);
    assert.deepEqual(await outbox.rearmAbandonedEffects(), []);
    assert.deepEqual(
      { status: (await rowOf())?.status, attempts: (await rowOf())?.attempts },
      { status: "pending", attempts: 0 },
    );
    assert.deepEqual(await items("credit_note_not_issued"), []);

    // Given up again at once: it waits another day.
    await giveUp(0);
    assert.deepEqual(await outbox.rearmAbandonedEffects(), []);

    // Kept past the retention while owed.
    await louezDb.db.execute(
      sql`UPDATE api_effects SET created_at = NOW() - INTERVAL 40 DAY WHERE id = ${effectId}`,
    );
    await outbox.pruneEffects();
    assert.equal((await rowOf())?.status, "abandoned");

    // Armed again and issued: done, and out of the inbox.
    await giveUp(25);
    const issued: string[] = [];
    const senders = {
      "payment.refundCreditNote": async (payload: { refundId: string }) => {
        issued.push(payload.refundId);
      },
    } as unknown as ApiEffectSenders;
    await outbox.dispatchEffects(await outbox.rearmAbandonedEffects(), senders);
    assert.deepEqual(issued, [`ref_note_${n}`]);
    assert.equal((await rowOf())?.status, "sent");
    assert.deepEqual(await items("credit_note_not_issued"), []);
  });
});
