import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The dashboard's reservation actions on a migrated database: the payment rows
// they write, with their billing facts, and the reservation's mark for the billing
// service in the same transaction (louez-billing docs/api, README §5.2, Q3, Q4, Q7).
// The deposit actions call Stripe first; their writes are tested in
// lib/reservations/dashboard-payment-writes.db.test.ts.

interface ResolveContext {
  parentURL?: string;
}
interface LoadContext {
  format?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };
type NextLoad = (url: string, context: LoadContext) => { format?: string; source?: unknown };

const STORE_KEY = "__louezActionsTestStore";
const STUB_SCHEME = "louez-actions-test:";
// The request context of a server action, which a test has no Next.js runtime for.
const STUBS: Record<string, string> = {
  "next/cache": "export function revalidatePath() {}\n",
  "@/lib/auth": "export async function auth() { return null; }\n",
  "@/lib/store-context": `export async function getCurrentStore() { return globalThis[${JSON.stringify(STORE_KEY)}] ?? null; }\n`,
};
const ACTIONS_FILE = "/dashboard/reservations/actions.ts";
const FILES_SDK = new URL("../../../../node_modules/files-sdk/dist/", import.meta.url);

const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    // date-change-request.server.ts imports "server-only", which throws outside Next.
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    // files-sdk exports ESM only, through an "import" condition the test's require misses.
    if (specifier === "files-sdk" || specifier.startsWith("files-sdk/")) {
      const entry = specifier === "files-sdk" ? "index.js" : `${specifier.slice(10)}/index.js`;
      return { shortCircuit: true, url: new URL(entry, FILES_SDK).href };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (parent.endsWith(ACTIONS_FILE) && specifier in STUBS) {
      return { shortCircuit: true, url: `${STUB_SCHEME}${specifier}` };
    }
    return nextResolve(specifier, context);
  },
  load(url: string, context: LoadContext, nextLoad: NextLoad) {
    if (url.startsWith(STUB_SCHEME)) {
      return { shortCircuit: true, format: "module", source: STUBS[url.slice(STUB_SCHEME.length)] };
    }
    return nextLoad(url, context);
  },
});

const STORE = "store_actions";
const START = new Date("2026-04-10T09:00:00.000Z");
const END = new Date("2026-04-12T09:00:00.000Z");

describe("dashboard reservation actions (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");
  let counter = 0;
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("dashboard_reservation_actions");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    actions = await import("./actions");

    await louezDb.db.insert(louezDb.customers).values({
      id: "customer_actions",
      storeId: STORE,
      email: "renter@example.test",
      firstName: "Renter",
      lastName: "Test",
    });
    // What getCurrentStore returns. No user id: analytics skips the event.
    Reflect.set(globalThis, STORE_KEY, {
      id: STORE,
      userId: "",
      name: "Actions",
      slug: "actions",
      settings: { currency: "usd" },
      stripeAccountId: null,
    });
  });

  after(async () => {
    Reflect.deleteProperty(globalThis, STORE_KEY);
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://localhost:3100";
  });

  afterEach(() => {
    for (const [name, value] of [
      ["LOUEZ_BILLING", env.billing],
      ["BILLING_SERVICE_URL", env.url],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  /** 110.00 tax included, 10.00 of it insurance, with no currency of its own. */
  async function createReservation(options: { withItems?: boolean } = {}) {
    const id = nextId("res");
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer_actions",
      number: id,
      status: "pending",
      startDate: START,
      endDate: END,
      subtotalAmount: "110.00",
      depositAmount: "50.00",
      totalAmount: "110.00",
      tulipInsuranceAmount: "10.00",
      source: "manual",
    });
    if (options.withItems) {
      await louezDb.db.insert(louezDb.reservationItems).values([
        {
          id: nextId("itm"),
          reservationId: id,
          productId: null,
          isCustomItem: true,
          quantity: 1,
          unitPrice: "100.00",
          depositPerUnit: "50.00",
          totalPrice: "100.00",
          taxRate: "20.00",
          productSnapshot: { name: "Bike", description: null, images: [] },
        },
        {
          id: nextId("itm"),
          reservationId: id,
          productId: null,
          isCustomItem: true,
          quantity: 1,
          unitPrice: "10.00",
          depositPerUnit: "0.00",
          totalPrice: "10.00",
          productSnapshot: { name: "Garantie casse/vol", description: null, images: [] },
        },
      ]);
    }
    return id;
  }

  async function readPayment(id: string) {
    const p = louezDb.payments;
    const [row] = await louezDb.db
      .select({
        amount: p.amount,
        type: p.type,
        method: p.method,
        status: p.status,
        currency: p.currency,
        grossMinor: p.grossMinor,
        insuranceShareMinor: p.insuranceShareMinor,
        origin: p.origin,
      })
      .from(p)
      .where(eq(p.id, id));
    return row;
  }

  async function countPayments(reservationId: string) {
    const rows = await louezDb.db
      .select({ id: louezDb.payments.id })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.reservationId, reservationId));
    return rows.length;
  }

  async function readMarkVersion(reservationId: string): Promise<number | null> {
    const q = louezDb.billingSyncQueue;
    const [row] = await louezDb.db
      .select({ version: q.version, storeId: q.storeId, status: q.status })
      .from(q)
      .where(and(eq(q.aggregateType, "reservation"), eq(q.aggregateId, reservationId)));
    if (!row) return null;
    assert.equal(row.storeId, STORE);
    assert.equal(row.status, "pending");
    return row.version;
  }

  function paymentIdOf(result: { error?: string; paymentId?: string }): string {
    assert.equal(result.error, undefined);
    assert.ok(result.paymentId);
    return result.paymentId;
  }

  describe("recordPayment", () => {
    test("a rental payment carries its facts, in the store's currency, and marks the reservation", async () => {
      const reservationId = await createReservation({ withItems: true });

      const paymentId = paymentIdOf(
        await actions.recordPayment(reservationId, { type: "rental", amount: 55, method: "cash" }),
      );

      assert.deepEqual(await readPayment(paymentId), {
        amount: "55.00",
        type: "rental",
        method: "cash",
        status: "completed",
        currency: "USD",
        grossMinor: 5500,
        insuranceShareMinor: 500,
        origin: "manual",
      });
      assert.equal(await readMarkVersion(reservationId), 1);
    });

    test("a negative adjustment keeps its sign and carries no insurance", async () => {
      const reservationId = await createReservation();

      const paymentId = paymentIdOf(
        await actions.recordPayment(reservationId, {
          type: "adjustment",
          amount: -10,
          method: "other",
        }),
      );

      const payment = await readPayment(paymentId);
      assert.equal(payment?.grossMinor, -1000);
      assert.equal(payment?.insuranceShareMinor, 0);
      assert.equal(await readMarkVersion(reservationId), 1);
    });

    test("a refused payment writes nothing and marks nothing", async () => {
      const reservationId = await createReservation();

      assert.deepEqual(
        await actions.recordPayment(reservationId, { type: "rental", amount: 0, method: "cash" }),
        { error: "errors.invalidAmount" },
      );
      assert.equal(await countPayments(reservationId), 0);
      assert.equal(await readMarkVersion(reservationId), null);
    });

    test("without the billing service, the payment is recorded and nothing is marked", async () => {
      delete process.env.BILLING_SERVICE_URL;
      const reservationId = await createReservation();

      const paymentId = paymentIdOf(
        await actions.recordPayment(reservationId, { type: "deposit", amount: 50, method: "cash" }),
      );

      assert.equal((await readPayment(paymentId))?.grossMinor, 5000);
      assert.equal(await readMarkVersion(reservationId), null);
    });
  });

  test("returnDeposit and recordDamage record their facts and mark the reservation", async () => {
    const reservationId = await createReservation();
    paymentIdOf(
      await actions.recordPayment(reservationId, { type: "deposit", amount: 50, method: "cash" }),
    );

    const returnId = paymentIdOf(
      await actions.returnDeposit(reservationId, { amount: 20, method: "cash" }),
    );
    const damageId = paymentIdOf(
      await actions.recordDamage(reservationId, { amount: 15, method: "card", notes: "scratch" }),
    );

    const returned = await readPayment(returnId);
    assert.equal(returned?.origin, "deposit");
    assert.equal(returned?.currency, "USD");
    assert.equal(returned?.grossMinor, 2000);
    const damage = await readPayment(damageId);
    assert.equal(damage?.origin, "manual");
    assert.equal(damage?.grossMinor, 1500);
    assert.equal(damage?.insuranceShareMinor, 0);
    assert.equal(await readMarkVersion(reservationId), 3);
  });

  describe("deletePayment", () => {
    test("deletes the payment and marks the reservation", async () => {
      const reservationId = await createReservation();
      const paymentId = paymentIdOf(
        await actions.recordPayment(reservationId, { type: "damage", amount: 5, method: "cash" }),
      );

      assert.deepEqual(await actions.deletePayment(paymentId), { success: true });

      assert.equal(await readPayment(paymentId), undefined);
      assert.equal(await readMarkVersion(reservationId), 2);
    });

    test("a Stripe payment is not deleted and nothing is marked", async () => {
      const reservationId = await createReservation();
      const paymentId = nextId("pay");
      await louezDb.db.insert(louezDb.payments).values({
        id: paymentId,
        reservationId,
        amount: "20.00",
        type: "rental",
        method: "stripe",
        status: "completed",
      });

      assert.deepEqual(await actions.deletePayment(paymentId), {
        error: "errors.cannotDeleteStripePayment",
      });
      assert.equal(await countPayments(reservationId), 1);
      assert.equal(await readMarkVersion(reservationId), null);
    });
  });

  describe("updateReservation", () => {
    test("an edit marks the reservation in its transaction", async () => {
      const reservationId = await createReservation();
      const newEnd = new Date("2026-04-13T09:00:00.000Z");

      const result = await actions.updateReservation(reservationId, { endDate: newEnd });

      assert.equal("error" in result ? result.error : undefined, undefined);
      const [row] = await louezDb.db
        .select({ endDate: louezDb.reservations.endDate })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, reservationId));
      assert.deepEqual(row?.endDate, newEnd);
      assert.equal(await readMarkVersion(reservationId), 1);
    });

    test("an edited checkout booking in a store that prices before tax keeps its tax in the snapshot", async () => {
      const storeId = "store_actions_ht";
      const settings = {
        reservationMode: "request" as const,
        advanceNoticeMinutes: 0,
        currency: "eur",
        tax: { enabled: true, defaultRate: 20, displayMode: "exclusive" as const },
      };
      await louezDb.db
        .insert(louezDb.stores)
        .values({ id: storeId, userId: "user_ht", name: "HT", slug: "actions-ht", settings });
      await louezDb.db.insert(louezDb.products).values({
        id: "product_ht",
        storeId,
        name: "Bike",
        price: "50.00",
        pricingMode: "day",
      });
      // What the checkout writes for two days at 50.00 before tax: the item with
      // its rate and split, a total of 120.00 tax included.
      const reservationId = nextId("res");
      await louezDb.db.insert(louezDb.reservations).values({
        id: reservationId,
        storeId,
        customerId: "customer_actions",
        number: reservationId,
        status: "pending",
        startDate: START,
        endDate: END,
        subtotalAmount: "100.00",
        depositAmount: "0.00",
        totalAmount: "120.00",
        subtotalExclTax: "100.00",
        taxAmount: "20.00",
        taxRate: "20.00",
        source: "online",
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: nextId("itm"),
        reservationId,
        productId: "product_ht",
        quantity: 1,
        unitPrice: "50.00",
        depositPerUnit: "0.00",
        totalPrice: "100.00",
        taxRate: "20.00",
        taxAmount: "20.00",
        priceExclTax: "50.00",
        totalExclTax: "100.00",
        productSnapshot: { name: "Bike", description: null, images: [] },
      });

      const previousStore = Reflect.get(globalThis, STORE_KEY);
      Reflect.set(globalThis, STORE_KEY, {
        id: storeId,
        userId: "",
        name: "HT",
        slug: "actions-ht",
        settings,
        stripeAccountId: null,
      });
      try {
        const result = await actions.updateReservation(reservationId, {
          endDate: new Date("2026-04-13T09:00:00.000Z"),
        });
        assert.equal("error" in result ? result.error : undefined, undefined);
      } finally {
        Reflect.set(globalThis, STORE_KEY, previousStore);
      }

      // The edit reprices the item before tax and adds no tax to the total.
      const [row] = await louezDb.db
        .select({ totalAmount: louezDb.reservations.totalAmount })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, reservationId));
      assert.equal(row?.totalAmount, "150.00");

      const { buildSnapshot } = await import("@/lib/billing-sync/snapshots/build-snapshot");
      const built = await buildSnapshot(
        louezDb.db,
        { type: "reservation", aggregateId: reservationId, storeId },
        { newStoresFrom: new Date("2027-01-25T00:00:00Z") },
      );
      assert.ok(built.kind === "snapshot" && "totalInclTaxMinor" in built.data);
      // 150.00 before tax at the item's 20 %, as the checkout would have charged it.
      assert.equal(built.data.totalInclTaxMinor, 18000);
    });

    test("a refused edit marks nothing", async () => {
      const reservationId = await createReservation();

      const result = await actions.updateReservation(reservationId, {
        endDate: new Date("2026-04-01T09:00:00.000Z"),
      });

      assert.deepEqual(result, { error: "errors.endDateBeforeStart" });
      assert.equal(await readMarkVersion(reservationId), null);
    });
  });
});
