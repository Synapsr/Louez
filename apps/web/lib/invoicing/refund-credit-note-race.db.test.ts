import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// The credit note of one refund, asked twice at once of the real generator
// (`generateCreditNoteForRefund`, service.ts) on a migrated database: one document,
// one credit note, one link to the refund. Only what leaves the database is replaced:
// the PDF's rendering. The generator stores its document in its own row and sends no
// e-mail.

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

const PDF_STUB = new URL("./refund-credit-note-race.stubs.mjs", import.meta.url).href;
const STUBS: Record<string, string> = {
  // The invoice PDF imports "server-only", which throws outside Next.
  "server-only": "node:module",
  "@react-pdf/renderer": PDF_STUB,
  "@/lib/pdf/invoice": PDF_STUB,
  "@/lib/pdf/generate": PDF_STUB,
};
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    const stub = STUBS[specifier];
    if (stub) return { shortCircuit: true, url: stub };
    return nextResolve(specifier, context);
  },
});

const STORE = "store_credit_race";

describe(
  "a refund's credit note, asked twice at once (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let service: typeof import("./service");

    before(async () => {
      database = await createTestDatabase("credit_note_race");
      louezDb = await import("@louez/db");
      service = await import("./service");
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner",
        name: "Credit race",
        slug: "credit-race",
        settings: { currency: "EUR", country: "FR", timezone: "Europe/Paris" } as never,
      });
      await louezDb.db.insert(louezDb.storeLegalProfiles).values({
        id: "legal_credit_race",
        storeId: STORE,
        legalName: "Credit race SAS",
        legalForm: "SAS",
        companyNumber: "123456789",
        registeredAddress: "1 rue de la Paix",
        registeredPostalCode: "75002",
        registeredCity: "Paris",
        country: "FR",
        invoicingEnabled: true,
      } as never);
      await louezDb.db.insert(louezDb.customers).values({
        id: "customer_credit_race",
        storeId: STORE,
        email: "customer@example.test",
        firstName: "Ada",
        lastName: "Lovelace",
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    test("one document, one credit note, one link to the refund", async () => {
      const reservationId = "res_credit_race";
      await louezDb.db.insert(louezDb.reservations).values({
        id: reservationId,
        storeId: STORE,
        customerId: "customer_credit_race",
        number: "R-1",
        status: "confirmed",
        startDate: new Date("2026-10-01T09:00:00Z"),
        endDate: new Date("2026-10-03T09:00:00Z"),
        subtotalAmount: "100.00",
        depositAmount: "0.00",
        totalAmount: "100.00",
        currency: "EUR",
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: "item_credit_race",
        reservationId,
        quantity: 1,
        unitPrice: "100.00",
        depositPerUnit: "0.00",
        totalPrice: "100.00",
        productSnapshot: { name: "Bike", description: null, images: [] },
      } as never);
      await louezDb.db.insert(louezDb.payments).values({
        id: "pay_credit_race",
        reservationId,
        amount: "100.00",
        type: "rental",
        method: "stripe",
        status: "completed",
        stripePaymentIntentId: "pi_credit_race",
        stripeChargeId: "ch_credit_race",
        currency: "EUR",
        paidAt: new Date("2026-10-01T09:30:00Z"),
      });
      const invoice = await service.generateInvoiceForPayment("pay_credit_race");
      assert.equal(invoice.status, "generated", JSON.stringify(invoice));
      await louezDb.db.insert(louezDb.payments).values({
        id: "ref_credit_race",
        reservationId,
        amount: "60.00",
        type: "rental",
        method: "stripe",
        status: "completed",
        stripeRefundId: "re_credit_race",
        refundOfPaymentId: "pay_credit_race",
        currency: "EUR",
        grossMinor: 6_000,
        paidAt: new Date("2026-10-02T09:30:00Z"),
      });

      const context = { originalPaymentId: "pay_credit_race", refundPaymentId: "ref_credit_race" };
      const results = await raceOnLockedRow(
        database,
        { table: "payments", id: "ref_credit_race" },
        [
          () => service.generateCreditNoteForRefund(context, "60.00"),
          () => service.generateCreditNoteForRefund(context, "60.00"),
        ],
      );

      assert.deepEqual(results.map((result) => result.status).sort(), ["generated", "skipped"]);
      const notes = await louezDb.db
        .select({ id: louezDb.invoices.id, documentId: louezDb.invoices.documentId })
        .from(louezDb.invoices)
        .where(
          and(
            eq(louezDb.invoices.reservationId, reservationId),
            eq(louezDb.invoices.type, "credit_note"),
          ),
        );
      assert.equal(notes.length, 1);
      const links = await louezDb.db
        .select({ invoiceId: louezDb.invoicePayments.invoiceId })
        .from(louezDb.invoicePayments)
        .where(eq(louezDb.invoicePayments.paymentId, "ref_credit_race"));
      assert.deepEqual(links, [{ invoiceId: notes[0]?.id }]);
      // The original invoice's document and the credit note's: two in all.
      const documents = await louezDb.db
        .select({ id: louezDb.documents.id })
        .from(louezDb.documents)
        .where(eq(louezDb.documents.reservationId, reservationId));
      assert.equal(documents.length, 2);
    });
  },
);
