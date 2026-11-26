import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// A payment recorded by an API key, through the real procedure, the app's
// real writer and its billing facts (`paymentRecordsPort`,
// lib/reservations/payment-billing-facts.ts), on a migrated database: the
// facts the row takes are computed under the reservation's lock, bound with
// the preview, and written as they were bound. A reservation whose totals
// change between the preview and the call that carries it out makes other
// facts, and the call is refused through the person's approval it presents
// (`money` is live: an API key's payment needs one).

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
const directory = mkdtempSync(join(tmpdir(), "louez-payment-port-"));
const authStubPath = join(directory, "auth.mjs");
writeFileSync(
  authStubPath,
  `export const auth = {};
export const mcpOAuth = null;
export const authInstance = {
  api: {
    getSession: async ({ headers }) => {
      const id = headers.get(${JSON.stringify(SESSION_HEADER)});
      return id ? { user: { id, email: id + "@port.test" } } : null;
    },
  },
};`,
);
after(() => rmSync(directory, { recursive: true }));

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
    if (specifier === "@louez/auth") {
      return { url: pathToFileURL(authStubPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const STORE = "store_payment_port";
const OWNER = "user_payment_port";
const SETTINGS = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 0,
  turnoverBufferMinutes: 0,
  currency: "EUR",
} as const;

type Call = (input: object, confirmation?: string) => Promise<unknown>;

describe(
  "a recorded payment's billing facts, bound (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let record: Call;
    let remove: Call;
    let decide: (id: string) => Promise<void>;
    let counter = 0;
    /** The outbox rows the procedure dispatched once committed. */
    const dispatched: string[] = [];

    before(async () => {
      database = await createTestDatabase("payment_records_port");
      louezDb = await import("@louez/db");
      const { paymentRecordsPort } = await import("@/lib/api/payment-records-port");
      // packages/api is ES modules: its router needs the CommonJS packages' names by hand.
      await import("@louez/mcp/testing/cjs-named-exports");
      const { appRouter } = await import("@louez/api/router");
      const { STORE_HEADER } = await import("@louez/api/platform/procedures");
      const { createApiKey } = await import("@louez/api/services");
      const { createRouterClient } = await import("@orpc/server");

      const ports = {
        planFeatures: async () => ({ apiAccess: true }),
        runReservationEffects: async () => {},
        insurance: { createContract: async () => null, cancelContract: async () => {} },
        newStores: createTestNewStores(),
        dispatchEffects: (ids: readonly string[]) => {
          dispatched.push(...ids);
        },
        storage: createMemoryStorage(),
        urls: createTestUrls(),
        afterCommit: () => {},
        paymentRecords: paymentRecordsPort,
      };

      await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@port.test" });
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: OWNER,
        name: "Payment port",
        slug: "payment-port",
        settings: SETTINGS,
      });
      await louezDb.db
        .insert(louezDb.storeMembers)
        .values({ storeId: STORE, userId: OWNER, role: "owner" });
      const key = await createApiKey({
        db: louezDb.db,
        storeId: STORE,
        userId: OWNER,
        name: "Payments agent",
        permissions: {
          reservations: "read",
          products: "read",
          customers: "read",
          categories: "read",
          payments: "write",
          analytics: "read",
          settings: "read",
        },
      });

      record = (input, confirmation) =>
        createRouterClient(appRouter.dashboard.payments, {
          context: {
            headers: new Headers({
              authorization: `Bearer ${key.key}`,
              ...(confirmation ? { "louez-confirmation": confirmation } : {}),
            }),
            transport: "openapi" as const,
            ports,
            receipt: {},
          },
          path: ["dashboard", "payments"],
        }).record(input as never);
      remove = (input, confirmation) =>
        createRouterClient(appRouter.dashboard.payments, {
          context: {
            headers: new Headers({
              authorization: `Bearer ${key.key}`,
              ...(confirmation ? { "louez-confirmation": confirmation } : {}),
            }),
            transport: "openapi" as const,
            ports,
            receipt: {},
          },
          path: ["dashboard", "payments"],
        }).delete(input as never);
      const handoffs = createRouterClient(appRouter.dashboard.handoffs, {
        context: {
          headers: new Headers({ [SESSION_HEADER]: OWNER, [STORE_HEADER]: STORE }),
          transport: "rpc" as const,
          ports,
          receipt: {},
        },
        path: ["dashboard", "handoffs"],
      });
      decide = async (id) => {
        const [row] = await louezDb.db
          .select()
          .from(louezDb.apiHandoffs)
          .where(eq(louezDb.apiHandoffs.id, id));
        assert.ok(row);
        await handoffs.decide({
          id,
          decision: "approve",
          revision: row.revision,
          shown: row.bindingHash ?? "",
          acknowledged: true,
        } as never);
      };
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    /** €98.00 tax included, without insurance: the reviewer's reservation. */
    async function reservation(): Promise<string> {
      const id = `res_port_${++counter}`;
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: "customer",
        number: id,
        status: "confirmed",
        startDate: new Date("2027-03-01T09:00:00Z"),
        endDate: new Date("2027-03-03T09:00:00Z"),
        subtotalAmount: "98.00",
        depositAmount: "0.00",
        totalAmount: "98.00",
        currency: "EUR",
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        reservationId: id,
        productId: null,
        quantity: 1,
        unitPrice: "98.00",
        depositPerUnit: "0.00",
        totalPrice: "98.00",
        productSnapshot: { name: "Bike", description: null, images: [] },
      });
      return id;
    }

    /** The reservation's total becomes €200.00, €40.00 of it insurance: status, currency and taxes unchanged. */
    const insure = (id: string) =>
      louezDb.db
        .update(louezDb.reservations)
        .set({ totalAmount: "200.00", subtotalAmount: "160.00", tulipInsuranceAmount: "40.00" })
        .where(eq(louezDb.reservations.id, id));

    const rowsOf = (id: string) =>
      louezDb.db
        .select({
          amount: louezDb.payments.amount,
          currency: louezDb.payments.currency,
          grossMinor: louezDb.payments.grossMinor,
          insuranceShareMinor: louezDb.payments.insuranceShareMinor,
        })
        .from(louezDb.payments)
        .where(eq(louezDb.payments.reservationId, id));

    const codeOf = async (call: Promise<unknown>) => {
      try {
        await call;
      } catch (error) {
        const data = (error as { data?: { code?: string; details?: Record<string, unknown> } })
          .data;
        return { code: data?.code, details: data?.details ?? {} };
      }
      return { code: "OK", details: {} };
    };

    const rental = (reservationId: string) => ({
      reservationId,
      type: "rental",
      amount: "120.00",
      method: "cash",
    });

    /** Carries out the agent's call through the person's approval. */
    async function approved(call: Call, input: object) {
      const asked = await codeOf(call(input));
      assert.equal(asked.code, "APPROVAL_REQUIRED");
      const approval = String(asked.details.confirmationToken);
      await decide(approval);
      assert.equal(await codeOf(call(input, approval)).then((r) => r.code), "OK");
    }

    /** A Checkout Session of the rental, open: its payment row `pending`. */
    async function openRentalSession(reservationId: string) {
      const id = `pay_open_${++counter}`;
      await louezDb.db.insert(louezDb.payments).values({
        id,
        reservationId,
        amount: "98.00",
        type: "rental",
        method: "stripe",
        status: "pending",
        stripeCheckoutSessionId: `cs_${id}`,
        origin: "customer_session",
        currency: "EUR",
      });
      return id;
    }

    const sessionExpiriesOf = (reservationId: string) =>
      louezDb.db
        .select({ id: louezDb.apiEffects.id, payload: louezDb.apiEffects.payload })
        .from(louezDb.apiEffects)
        .where(eq(louezDb.apiEffects.reservationId, reservationId));

    test("a rental payment recorded expires the rental's open sessions, dispatched once committed; a deposit queues none", async () => {
      const rentalPaid = await reservation();
      const depositPaid = await reservation();
      const open = await openRentalSession(rentalPaid);
      await openRentalSession(depositPaid);

      await approved(record, { ...rental(rentalPaid), amount: "20.00" });
      await approved(record, { ...rental(depositPaid), type: "deposit", amount: "20.00" });

      const queued = await sessionExpiriesOf(rentalPaid);
      assert.deepEqual(
        queued.map((row) => row.payload),
        [{ reservationId: rentalPaid, paymentIds: [open] }],
      );
      assert.ok(dispatched.includes(String(queued[0]?.id)), "dispatched once committed");
      assert.deepEqual(await sessionExpiriesOf(depositPaid), []);
    });

    test("a refund given by hand deleted expires the rental's open sessions; a payment deleted queues none", async () => {
      const refundDeleted = await reservation();
      const paymentDeleted = await reservation();
      const rows = [refundDeleted, paymentDeleted].map((reservationId) => ({
        paid: `pay_cash_${++counter}`,
        refund: `pay_back_${++counter}`,
        reservationId,
      }));
      for (const { paid, refund, reservationId } of rows) {
        await louezDb.db.insert(louezDb.payments).values([
          {
            id: paid,
            reservationId,
            amount: "98.00",
            type: "rental",
            method: "cash",
            status: "completed",
            currency: "EUR",
          },
          {
            id: refund,
            reservationId,
            amount: "20.00",
            type: "rental",
            method: "cash",
            status: "completed",
            refundOfPaymentId: paid,
            currency: "EUR",
          },
        ]);
      }
      const open = await openRentalSession(refundDeleted);
      await openRentalSession(paymentDeleted);

      await approved(remove, { paymentId: rows[0]?.refund });
      await approved(remove, { paymentId: rows[1]?.paid });

      const queued = await sessionExpiriesOf(refundDeleted);
      assert.deepEqual(
        queued.map((row) => row.payload),
        [{ reservationId: refundDeleted, paymentIds: [open] }],
      );
      assert.ok(dispatched.includes(String(queued[0]?.id)), "dispatched once committed");
      assert.deepEqual(await sessionExpiriesOf(paymentDeleted), []);
    });

    test("unchanged, the row takes the facts bound with the preview", async () => {
      const id = await reservation();
      const asked = await codeOf(record(rental(id)));
      assert.equal(asked.code, "APPROVAL_REQUIRED");
      const approval = String(asked.details.confirmationToken);
      await decide(approval);
      assert.equal(await codeOf(record(rental(id), approval)).then((r) => r.code), "OK");
      assert.deepEqual(await rowsOf(id), [
        { amount: "120.00", currency: "EUR", grossMinor: 12000, insuranceShareMinor: 0 },
      ]);
    });

    test("an approval: the reservation insured since the person approved, the call is refused, nothing is written, and the approval ends as state_changed", async () => {
      const id = await reservation();
      const asked = await codeOf(record(rental(id)));
      assert.equal(asked.code, "APPROVAL_REQUIRED");
      const approval = String(asked.details.confirmationToken);
      await decide(approval);
      await insure(id);
      const presented = await codeOf(record(rental(id), approval));
      assert.equal(presented.code, "APPROVAL_INVALID");
      assert.deepEqual(presented.details, { reason: "state_changed" });
      assert.deepEqual(await rowsOf(id), []);
      const [row] = await louezDb.db
        .select({
          status: louezDb.apiHandoffs.status,
          failureCode: louezDb.apiHandoffs.failureCode,
        })
        .from(louezDb.apiHandoffs)
        .where(eq(louezDb.apiHandoffs.id, approval));
      assert.deepEqual(row, { status: "failed", failureCode: "state_changed" });

      // Asked again, the person sees the facts as they are now, and the row takes them.
      const again = await codeOf(record(rental(id)));
      assert.equal(again.code, "APPROVAL_REQUIRED");
      const next = String(again.details.confirmationToken);
      await decide(next);
      assert.equal((await codeOf(record(rental(id), next))).code, "OK");
      assert.deepEqual(await rowsOf(id), [
        { amount: "120.00", currency: "EUR", grossMinor: 12000, insuranceShareMinor: 2400 },
      ]);
    });
  },
);
