import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The credit note a refund given by hand is owed, from the writer to the
// invoicing: the real writer (`recordPaymentRefund`, packages/api), the app's
// real refund row (`createPaymentRefundsPort`), the real outbox
// (`enqueueEffects`, `dispatchEffects`) and the real sender
// (`createRefundCreditNoteEffectSenders`), on a migrated database. The
// invoicing stands in: it issues one credit note per refund, as
// `generateCreditNoteForRefund` does (it answers `already_invoiced` for a
// refund already credited), and can fail or be turned off.

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    return next(specifier, context);
  },
});

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const STORE = "store_refund_notes";
const OTHER_STORE = "store_refund_other";
const OWNER = "user_refund_notes";
const CUSTOMER = "customer_refund_notes";

describe(
  "a refund's credit note, owed through the outbox (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let effects: typeof import("@louez/api/platform/effects");
    let writer: typeof import("@louez/api/services/payment-records");
    let senders: ReturnType<
      typeof import("./refund-credit-note-effects").createRefundCreditNoteEffectSenders
    >;
    let port: import("@louez/api").PaymentRefundsPort;
    let issue: (
      request: import("./refund-credit-note").RefundCreditNoteRequest,
    ) => Promise<import("@louez/api").RefundCreditNoteOutcome>;
    let counter = 0;

    /** The invoicing, standing in: one credit note per refund, a failure on demand, or none at all. */
    const invoicing = {
      notes: new Map<string, string>(),
      calls: 0,
      failNext: 0,
      disabled: false,
    };
    /** What the outbox sent to error tracking. */
    let reported: string[] = [];
    let dispatched: string[] = [];

    before(async () => {
      database = await createTestDatabase("refund_credit_notes");
      louezDb = await import("@louez/db");
      // The app's modules first, under the hook above.
      const { issueRefundCreditNote } = await import("./refund-credit-note");
      const { createRefundCreditNoteEffectSenders } = await import("./refund-credit-note-effects");
      const { createPaymentRefundsPort } = await import("@/lib/api/payment-refunds-port");
      // packages/api is ES modules: its services need the CommonJS packages' names by hand.
      await import("@louez/mcp/testing/cjs-named-exports");
      effects = await import("@louez/api/platform/effects");
      writer = await import("@louez/api/services/payment-records");

      issue = (request) =>
        issueRefundCreditNote(request, {
          generate: async (context) => {
            invoicing.calls += 1;
            if (invoicing.disabled) return { status: "skipped", reason: "invoicing_disabled" };
            if (invoicing.failNext > 0) {
              invoicing.failNext -= 1;
              return { status: "skipped", reason: "generation_failed" };
            }
            if (invoicing.notes.has(context.refundPaymentId)) {
              return { status: "skipped", reason: "already_invoiced" };
            }
            const number = `AV-${invoicing.notes.size + 1}`;
            invoicing.notes.set(context.refundPaymentId, number);
            return {
              status: "generated",
              invoiceId: `inv_${number}`,
              documentId: `doc_${number}`,
              number,
              reservationId: "unused",
              kind: "credit_note",
            };
          },
          issuedNumber: async (refundId) => invoicing.notes.get(refundId) ?? null,
        });
      port = createPaymentRefundsPort({ creditNote: issue });
      senders = createRefundCreditNoteEffectSenders({ issue });

      await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@notes.test" });
      await louezDb.db.insert(louezDb.stores).values([
        { id: STORE, userId: OWNER, name: "Refund notes", slug: "refund-notes" },
        { id: OTHER_STORE, userId: OWNER, name: "Other store", slug: "refund-other" },
      ]);
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: "ada@notes.test",
        firstName: "Ada",
        lastName: "Lovelace",
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(() => {
      invoicing.notes.clear();
      invoicing.calls = 0;
      invoicing.failNext = 0;
      invoicing.disabled = false;
      reported = [];
      dispatched = [];
    });

    /** A reservation with a rental of 80.00 taken in cash. */
    async function paid() {
      counter += 1;
      const reservationId = `res_notes_${counter}`;
      await louezDb.db.insert(louezDb.reservations).values({
        id: reservationId,
        storeId: STORE,
        customerId: CUSTOMER,
        number: `N-${counter}`,
        status: "confirmed",
        currency: "EUR",
        startDate: new Date("2031-06-01T09:00:00Z"),
        endDate: new Date("2031-06-03T09:00:00Z"),
        subtotalAmount: "80.00",
        depositAmount: "0.00",
        totalAmount: "80.00",
      });
      const [payment] = await louezDb.db
        .insert(louezDb.payments)
        .values({
          reservationId,
          type: "rental",
          amount: "80.00",
          method: "cash",
          status: "completed",
          currency: "EUR",
        })
        .$returningId();
      return { reservationId, paymentId: payment.id };
    }

    /** The dashboard's call: nothing asked; the dispatch is recorded rather than run. */
    const refund = (
      paymentId: string,
      amount: string,
      overrides: { port?: import("@louez/api").PaymentRefundsPort } = {},
    ) =>
      writer.recordPaymentRefund(
        {
          storeId: STORE,
          storeSettings: null,
          port: overrides.port ?? port,
          confirm: async () => null,
          dispatchEffects: (ids) => {
            dispatched.push(...ids);
          },
        },
        { paymentId, amount, method: "cash" },
        { source: "test" },
      );

    /** The outbox's run of rows, as the dispatch after the answer or the cron makes it. */
    const run = (ids: readonly string[]) =>
      effects.dispatchEffects(ids, senders as never, {
        report: (error) => {
          reported.push(error instanceof Error ? error.message : String(error));
        },
      });

    const rowOf = async (id: string) => {
      const [row] = await louezDb.db
        .select({ status: louezDb.apiEffects.status, lastError: louezDb.apiEffects.lastError })
        .from(louezDb.apiEffects)
        .where(eq(louezDb.apiEffects.id, id));
      return row;
    };

    /** The credit-note rows the outbox holds for a payment's refunds, as the cron would find them. */
    const owedFor = async (paymentId: string) =>
      (
        await louezDb.db
          .select({ id: louezDb.apiEffects.id, payload: louezDb.apiEffects.payload })
          .from(louezDb.apiEffects)
          .where(
            and(
              eq(louezDb.apiEffects.storeId, STORE),
              eq(louezDb.apiEffects.type, "payment.refundCreditNote"),
            ),
          )
      )
        .filter((row) => (row.payload as { paymentId?: string }).paymentId === paymentId)
        .map((row) => row.id);

    test("invoicing that fails once: the answer says pending, and the outbox issues the credit note, once", async () => {
      const { paymentId } = await paid();
      invoicing.failNext = 1;

      const done = await refund(paymentId, "30.00");
      assert.deepEqual(done.creditNote, { status: "pending", number: null });
      assert.equal(invoicing.notes.size, 0);
      assert.equal(dispatched.length, 1);

      assert.deepEqual(await run(dispatched), { sent: 1, failed: 0, skipped: 0 });
      assert.deepEqual([...invoicing.notes.entries()], [[done.refundId, "AV-1"]]);
      assert.equal((await rowOf(dispatched[0] ?? ""))?.status, "sent");
      // Run again (a late dispatch, the cron): the row is done, nothing is issued twice.
      await run(dispatched);
      assert.equal(invoicing.notes.size, 1);
      assert.equal(invoicing.calls, 2, "the writer's attempt, then the outbox's one run");
    });

    test("a crash between the commit and the invoicing: the row the cron finds still issues it, once", async () => {
      const { paymentId } = await paid();
      // The process dies once the refund committed: no attempt, no dispatch.
      const dying: import("@louez/api").PaymentRefundsPort = {
        insert: port.insert,
        creditNote: async () => ({ status: "failed", reason: "the process died" }),
      };
      const done = await refund(paymentId, "20.00", { port: dying });
      assert.equal(invoicing.calls, 0);

      const owed = await owedFor(paymentId);
      assert.equal(owed.length, 1, "owed by a row written with the refund");
      await run(owed);
      assert.deepEqual([...invoicing.notes.entries()], [[done.refundId, "AV-1"]]);
      await run(owed);
      assert.equal(invoicing.notes.size, 1);
    });

    test("issued at once: the outbox's run finds it issued and issues no second one", async () => {
      const { paymentId } = await paid();
      const done = await refund(paymentId, "10.00");
      assert.deepEqual(done.creditNote, { status: "issued", number: "AV-1" });

      await run(dispatched);
      assert.equal(invoicing.notes.size, 1);
      assert.equal((await rowOf(dispatched[0] ?? ""))?.status, "sent");
    });

    test("invoicing turned off: not_applicable, and the row ends with nothing to issue", async () => {
      const { paymentId } = await paid();
      invoicing.disabled = true;
      const done = await refund(paymentId, "10.00");
      assert.deepEqual(done.creditNote, { status: "not_applicable", number: null });

      await run(dispatched);
      assert.deepEqual(await rowOf(dispatched[0] ?? ""), {
        status: "cancelled",
        lastError: "Skipped: not_applicable: invoicing_disabled",
      });
      assert.deepEqual(reported, [], "nothing to issue is nothing wrong");
    });

    test("a row whose payload is not its own is given up at once, visibly, and issues nothing", async () => {
      const { reservationId, paymentId } = await paid();
      const done = await refund(paymentId, "10.00");
      invoicing.notes.clear();
      invoicing.calls = 0;
      const payload = {
        storeId: STORE,
        reservationId,
        paymentId,
        refundId: done.refundId,
        amount: "10.00",
        source: "test",
      };
      const rows = await louezDb.db.transaction((tx) =>
        effects.enqueueEffects(tx, STORE, [
          // Not the writer's payload.
          {
            type: "payment.refundCreditNote",
            reservationId,
            payload: { ...payload, amount: "ten" },
          },
          // Another store than its row's.
          {
            type: "payment.refundCreditNote",
            reservationId,
            payload: { ...payload, storeId: OTHER_STORE },
          },
          // A refund of another payment.
          {
            type: "payment.refundCreditNote",
            reservationId,
            payload: { ...payload, paymentId: "pay_someone_else" },
          },
          // Another amount than the refund's.
          {
            type: "payment.refundCreditNote",
            reservationId,
            payload: { ...payload, amount: "11.00" },
          },
        ]),
      );

      assert.deepEqual(await run(rows), { sent: 0, failed: 4, skipped: 0 });
      assert.equal(invoicing.calls, 0, "nothing was issued");
      const reasons = [
        "payload_invalid: not a refund's credit note",
        "row_mismatch: the payload names another store or reservation",
        "refund_mismatch: the refund is not this payment's, for this amount",
        "refund_mismatch: the refund is not this payment's, for this amount",
      ];
      // Given up at once, kept with its payload, and reported: never retried.
      for (const [index, id] of rows.entries()) {
        assert.deepEqual(await rowOf(id), {
          status: "abandoned",
          lastError: `Abandoned: ${reasons[index]}`,
        });
      }
      assert.equal(reported.length, 4);
    });

    test("the credit note's outcome: a refund already credited is issued with its number, a failure is a failure", async () => {
      const request = { paymentId: "p", refundId: "r", amount: "1.00", source: "test" };
      const outcome = (
        result: import("./service").InvoiceGenerationResult,
        number: string | null = null,
      ) =>
        import("./refund-credit-note").then(({ issueRefundCreditNote }) =>
          issueRefundCreditNote(request, {
            generate: async () => result,
            issuedNumber: async () => number,
          }),
        );
      assert.deepEqual(await outcome({ status: "skipped", reason: "already_invoiced" }, "AV-9"), {
        status: "issued",
        number: "AV-9",
      });
      assert.equal(
        (await outcome({ status: "skipped", reason: "already_invoiced" })).status,
        "failed",
      );
      for (const reason of [
        "invoicing_disabled",
        "feature_disabled",
        "payment_not_eligible",
      ] as const) {
        assert.equal(
          (await outcome({ status: "skipped", reason })).status,
          "not_applicable",
          reason,
        );
      }
      for (const reason of ["generation_failed", "payment_not_found"] as const) {
        assert.equal((await outcome({ status: "skipped", reason })).status, "failed", reason);
      }
    });
  },
);
