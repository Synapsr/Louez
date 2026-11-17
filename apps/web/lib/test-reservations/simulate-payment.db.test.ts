import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";
import type { Connection, RowDataPacket } from "mysql2/promise";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// A test reservation's simulated payment on a database (simulate-payment.ts):
// two calls at once, a call that fails halfway then its retry, and a call that
// finds another one running. The contract's document and the confirmation's
// messages are stubbed and recorded; the rest is the real code.

const directory = mkdtempSync(join(tmpdir(), "louez-simulated-payment-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezSimulatedPaymentStubs;");
after(() => rmSync(directory, { recursive: true }));

const STUBBED = new Set([
  "@/lib/billing/reservation-effects",
  "@/lib/evlog",
  "@/lib/invoicing/service",
  "@/lib/reservations/complete-checkout-payment",
]);

type Call = [name: string, ...args: unknown[]];
const calls: Call[] = [];
/** Writes the payment's contract document, as the invoicing service does for a test reservation. */
let generateContract: (paymentId: string) => Promise<void> = async () => {};
/** How many contract documents the reservation had when its messages were sent. */
let contractsAt: (reservationId: string) => Promise<number> = async () => 0;

Reflect.set(globalThis, "__louezSimulatedPaymentStubs", {
  runReservationEffects: async () => {},
  log: {
    error: (...args: unknown[]) => calls.push(["log.error", ...args]),
    warn: (...args: unknown[]) => calls.push(["log.warn", ...args]),
    info: () => {},
  },
  tryGenerateInvoiceForPayment: async (paymentId: string, source: string) => {
    calls.push(["tryGenerateInvoiceForPayment", paymentId, source]);
    await generateContract(paymentId);
    return { status: "skipped", reason: "test_reservation" };
  },
  loadReservationForCompletion: async (reservationId: string) => ({ id: reservationId }),
  sendPaidConfirmationMessages: async (reservation: { id: string }) => {
    calls.push(["sendPaidConfirmationMessages", reservation.id, await contractsAt(reservation.id)]);
  },
});

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (
      (parent.endsWith("/lib/test-reservations/simulate-payment.ts") ||
        parent.endsWith("/lib/billing-sync/locks.ts")) &&
      STUBBED.has(specifier)
    ) {
      return { url: pathToFileURL(stubsPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const START = new Date("2030-06-01T09:00:00Z");
const END = new Date("2030-06-03T09:00:00Z");

/** Makes the contract's validation fail, as a lost connection would. */
const FAIL_CONTRACT_VALIDATION = `CREATE TRIGGER test_fail_contract_validation BEFORE INSERT ON reservation_activity FOR EACH ROW
  BEGIN
    IF NEW.activity_type = 'modified' AND JSON_UNQUOTE(JSON_EXTRACT(NEW.metadata, '$.source')) = 'payment' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contract validation failed';
    END IF;
  END`;

describe(
  "a test reservation's simulated payment (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let raw: Connection;
    let louezDb: typeof import("@louez/db");
    let simulation: typeof import("./simulate-payment");
    let counter = 0;

    const nextId = (prefix: string) =>
      `${prefix}_${String(++counter).padStart(20 - prefix.length, "0")}`;

    before(async () => {
      database = await createTestDatabase("test_payment_simulation");
      louezDb = await import("@louez/db");
      simulation = await import("./simulate-payment");
      raw = await database.connect();
      generateContract = async (paymentId) => {
        const [payment] = await louezDb.db
          .select({ reservationId: louezDb.payments.reservationId })
          .from(louezDb.payments)
          .where(eq(louezDb.payments.id, paymentId));
        const reservationId = payment?.reservationId ?? "";
        await louezDb.db.insert(louezDb.documents).values({
          id: nextId("doc"),
          reservationId,
          type: "contract",
          number: `C-${counter}`,
          fileUrl: "https://files.example.test/contract.pdf",
          fileName: "contract.pdf",
        });
      };
      contractsAt = async (reservationId) =>
        (
          await louezDb.db
            .select({ id: louezDb.documents.id })
            .from(louezDb.documents)
            .where(
              and(
                eq(louezDb.documents.reservationId, reservationId),
                eq(louezDb.documents.type, "contract"),
              ),
            )
        ).length;
    });

    after(async () => {
      await raw?.end();
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      calls.length = 0;
      await raw.query("DROP TRIGGER IF EXISTS test_fail_contract_validation");
    });

    /** A store with its pending test reservation of one product it has two of. */
    async function pendingTestReservation() {
      const storeId = nextId("sto");
      const customerId = nextId("cus");
      const productId = nextId("prd");
      const reservationId = nextId("res");
      await louezDb.db.insert(louezDb.stores).values({
        id: storeId,
        userId: nextId("own"),
        name: "Test",
        slug: storeId.replaceAll("_", "-"),
        email: "shop@simulated.test",
        settings: {
          reservationMode: "request",
          currency: "EUR",
          advanceNoticeMinutes: 0,
          pendingBlocksAvailability: false,
        },
      });
      await louezDb.db.insert(louezDb.customers).values({
        id: customerId,
        storeId,
        email: "owner@simulated.test",
        firstName: "Owner",
        lastName: "Test",
        isTest: true,
      });
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId,
        name: "Kayak",
        price: "40.00",
        pricingMode: "day",
        quantity: 2,
      });
      await louezDb.db.insert(louezDb.reservations).values({
        id: reservationId,
        storeId,
        customerId,
        number: `T-${counter}`,
        status: "pending",
        startDate: START,
        endDate: END,
        subtotalAmount: "80.00",
        depositAmount: "0.00",
        totalAmount: "80.00",
        currency: "EUR",
        source: "online",
        isTest: true,
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: nextId("itm"),
        reservationId,
        productId,
        quantity: 1,
        unitPrice: "40.00",
        depositPerUnit: "0.00",
        totalPrice: "80.00",
        productSnapshot: { name: "Kayak", description: null, images: [] },
      });
      return { storeId, reservationId };
    }

    async function state(reservationId: string) {
      const [reservation] = await louezDb.db
        .select({
          status: louezDb.reservations.status,
          contractValidatedAt: louezDb.reservations.contractValidatedAt,
        })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, reservationId));
      const paymentRows = await louezDb.db
        .select({ amount: louezDb.payments.amount, method: louezDb.payments.method })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, reservationId));
      return {
        status: reservation?.status,
        validated: Boolean(reservation?.contractValidatedAt),
        payments: paymentRows,
        contracts: await contractsAt(reservationId),
      };
    }

    const named = (name: string) => calls.filter((call) => call[0] === name);

    test("two calls at once pay once, generate one contract, and send the messages once, after it", async () => {
      const input = await pendingTestReservation();

      const results = await Promise.all([
        simulation.simulateTestReservationPayment(input),
        simulation.simulateTestReservationPayment(input),
      ]);

      assert.deepEqual(
        results.map((result) => (result.ok ? result.confirmed : result.error)).sort(),
        [false, true],
      );
      assert.deepEqual(await state(input.reservationId), {
        status: "confirmed",
        validated: true,
        payments: [{ amount: "80.00", method: "other" }],
        contracts: 1,
      });
      assert.equal(named("tryGenerateInvoiceForPayment").length, 1);
      // Sent once, by the call that confirmed it, with the contract already there.
      assert.deepEqual(named("sendPaidConfirmationMessages"), [
        ["sendPaidConfirmationMessages", input.reservationId, 1],
      ]);
    });

    test("a call that fails after the payment's commit is finished by the next one", async () => {
      const input = await pendingTestReservation();
      await raw.query(FAIL_CONTRACT_VALIDATION);

      await assert.rejects(
        simulation.simulateTestReservationPayment(input),
        (error: Error) =>
          (error.cause as Error | undefined)?.message === "contract validation failed",
      );
      assert.deepEqual(await state(input.reservationId), {
        status: "pending",
        validated: false,
        payments: [{ amount: "80.00", method: "other" }],
        contracts: 0,
      });
      assert.deepEqual(named("sendPaidConfirmationMessages"), []);

      await raw.query("DROP TRIGGER test_fail_contract_validation");
      assert.deepEqual(await simulation.simulateTestReservationPayment(input), {
        ok: true,
        confirmed: true,
      });
      assert.deepEqual(await state(input.reservationId), {
        status: "confirmed",
        validated: true,
        payments: [{ amount: "80.00", method: "other" }],
        contracts: 1,
      });
      assert.deepEqual(named("sendPaidConfirmationMessages"), [
        ["sendPaidConfirmationMessages", input.reservationId, 1],
      ]);

      // Once confirmed, a call does nothing more.
      assert.deepEqual(await simulation.simulateTestReservationPayment(input), {
        ok: true,
        confirmed: false,
      });
      assert.equal(named("tryGenerateInvoiceForPayment").length, 1);
      assert.equal(named("sendPaidConfirmationMessages").length, 1);
    });

    test("a call that finds another one running answers busy and writes nothing", async () => {
      const input = await pendingTestReservation();
      const holder = await database.connect();
      try {
        await holder.query("SELECT GET_LOCK(?, 0)", [
          simulation.simulatedPaymentLockName(input.reservationId),
        ]);
        assert.deepEqual(await simulation.simulateTestReservationPayment(input), {
          ok: false,
          error: "busy",
        });
        assert.deepEqual((await state(input.reservationId)).payments, []);
      } finally {
        await holder.query<RowDataPacket[]>("SELECT RELEASE_LOCK(?)", [
          simulation.simulatedPaymentLockName(input.reservationId),
        ]);
        await holder.end();
      }
    });
  },
);
