import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { and, eq } from "drizzle-orm";

import {
  createTestDatabase,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type TestDatabase,
} from "@louez/db/testing";

// The store's status change (products, then the reservation) racing the
// paths that still lock the reservation first and retry a lost deadlock: a
// paid checkout's confirmation and a customer's quote acceptance. Whichever
// order the database picks, the reservation ends cancelled, its stock comes
// back, and each change and its effects happen once.

const directory = mkdtempSync(join(tmpdir(), "louez-status-races-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezRaceStubs;");
after(() => rmSync(directory, { recursive: true }));

// What the quote action calls besides the database: the customer's session,
// its emails and notifications, analytics, the page cache.
const STUBBED = new Set([
  "next/cache",
  "@/lib/customer-auth/session",
  "@/lib/customer-auth/instant-access",
  "@/lib/notifications/customer-dispatcher",
  "@/lib/notifications/dispatcher",
  "@/lib/product-analytics/analytics",
  "@/lib/reservations/payment-session",
  "@/lib/integrations/tulip/contracts",
]);
const quoteMessages: string[] = [];
Reflect.set(globalThis, "__louezRaceStubs", {
  revalidatePath: () => {},
  getCustomerSession: async () => ({ customerId: CUSTOMER }),
  createReservationInstantAccessUrl: async () => "https://shop.example.test/contract",
  dispatchCustomerNotification: async (event: string) => {
    quoteMessages.push(event);
    return { email: { sent: true }, sms: { sent: false } };
  },
  dispatchNotification: async () => ({}),
  captureProductServerEvent: async () => {},
  toAnalyticsAmountCents: () => 0,
  createReservationPaymentSessionForCustomer: async () => ({ success: false, error: "none" }),
  cancelTulipContractForReservation: async () => {},
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
    if (parent.includes("[reservationId]/actions.ts") && STUBBED.has(specifier)) {
      return { url: pathToFileURL(stubsPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const STORE = "store_status_races";
const STORE_SLUG = "status-races";
const OWNER = "user_status_races";
const CUSTOMER = "cus_status_races";

describe("status change races (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let statusChange: typeof import("@louez/api/services/reservation-status");
  let payment: typeof import("./complete-checkout-payment");
  let quotes: typeof import("@/app/(storefront)/[slug]/account/reservations/[reservationId]/actions");
  let dispatched: string[] = [];
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("status_races");
    louezDb = await import("@louez/db");
    payment = await import("./complete-checkout-payment");
    quotes = await import("@/app/(storefront)/[slug]/account/reservations/[reservationId]/actions");
    // packages/api is ES modules: its services need the CommonJS packages'
    // names by hand. Loaded last, as the mocks change how later modules load.
    await import("@louez/mcp/testing/cjs-named-exports");
    statusChange = await import("@louez/api/services/reservation-status");

    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Races",
      slug: STORE_SLUG,
      settings: {
        reservationMode: "request",
        currency: "EUR",
        advanceNoticeMinutes: 0,
        pendingBlocksAvailability: false,
      },
    });
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "ada@races.test",
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    dispatched = [];
    quoteMessages.length = 0;
  });

  // 21 characters, as nanoid ids: the quote action checks their shape.
  const nextId = (prefix: string) =>
    `${prefix}_${String(++counter).padStart(20 - prefix.length, "0")}`;

  /** A reservation of one consumable whose whole stock it takes once confirmed. */
  async function reservationOfLastUnit(status: "pending" | "quote") {
    const productId = nextId("prd");
    const id = nextId("res");
    await louezDb.db.insert(louezDb.products).values({
      id: productId,
      storeId: STORE,
      name: productId,
      price: "1.00",
      pricingMode: "day",
      stockKind: "consumable",
      quantity: 1,
    });
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: CUSTOMER,
      number: id,
      status,
      startDate: new Date("2030-06-01T09:00:00Z"),
      endDate: new Date("2030-06-03T09:00:00Z"),
      subtotalAmount: "1.00",
      depositAmount: "0.00",
      totalAmount: "1.00",
      source: "online",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: nextId("itm"),
      reservationId: id,
      productId,
      quantity: 1,
      unitPrice: "1.00",
      depositPerUnit: "0.00",
      totalPrice: "1.00",
      productSnapshot: { name: productId, description: null, images: [] },
    });
    return { id, productId };
  }

  const caller = () => ({
    storeId: STORE,
    userId: OWNER,
    transport: "rpc" as const,
    customers: true,
    store: {
      id: STORE,
      name: "Races",
      slug: STORE_SLUG,
      ownerUserId: OWNER,
      settings: null,
      customerNotificationSettings: null,
    },
    ports: {
      afterCommit: () => {},
      runReservationEffects: async () => {},
      insurance: { createContract: async () => null, cancelContract: async () => {} },
      dispatchEffects: (ids: readonly string[]) => {
        dispatched.push(...ids);
      },
    },
  });

  /** Holds the reservation's row while both calls start, then lets them race. */
  async function raceOnReservation<T>(id: string, calls: Array<() => Promise<T>>) {
    const holder = await database.connect();
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
      const running = Promise.all(calls.map((call) => call()));
      try {
        await waitForLockWaits(holder, database.name, calls.length);
      } finally {
        await holder.commit();
      }
      return await running;
    } finally {
      await holder.end();
    }
  }

  async function endState(id: string, productId: string) {
    const [row] = await louezDb.db
      .select({ status: louezDb.reservations.status })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, id));
    const [product] = await louezDb.db
      .select({ quantity: louezDb.products.quantity })
      .from(louezDb.products)
      .where(eq(louezDb.products.id, productId));
    const activity = await louezDb.db
      .select({ type: louezDb.reservationActivity.activityType })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, id));
    const cancellationEffects = await louezDb.db
      .select({ id: louezDb.apiEffects.id })
      .from(louezDb.apiEffects)
      .where(
        and(
          eq(louezDb.apiEffects.storeId, STORE),
          eq(louezDb.apiEffects.type, "reservation.statusAnalytics"),
        ),
      );
    const types = activity.map((entry) => entry.type);
    return {
      status: row?.status,
      stock: product?.quantity,
      cancelled: types.filter((type) => type === "cancelled").length,
      confirmed: types.filter((type) => type === "confirmed" || type === "quote_accepted").length,
      storeEffects: cancellationEffects.length,
    };
  }

  test("a store cancellation racing a paid checkout's confirmation", async () => {
    const { id, productId } = await reservationOfLastUnit("pending");
    await louezDb.db.delete(louezDb.apiEffects);

    const [cancelled, paid] = await raceOnReservation<unknown>(id, [
      () =>
        statusChange
          .changeStoreReservationStatus(caller(), { id, to: "cancelled" })
          .then((change) => change.to),
      () =>
        payment.confirmPaidReservationOrThrow({
          reservationId: id,
          storeId: STORE,
          stripeCustomerId: null,
          stripePaymentMethodId: null,
          depositStatus: "none",
          activityMetadata: { source: "race" },
        }),
    ]);
    assert.equal(cancelled, "cancelled");
    const state = await endState(id, productId);
    assert.equal(state.status, "cancelled");
    assert.equal(state.stock, 1, "the unit is back, whichever ran first");
    assert.equal(state.cancelled, 1);
    assert.equal(state.confirmed, paid ? 1 : 0, "a confirmation, when it won, happened once");
    assert.equal(state.storeEffects, 1, "the cancellation's effects were queued once");
  });

  test("a store cancellation racing a customer's quote acceptance", async () => {
    const { id, productId } = await reservationOfLastUnit("quote");
    await louezDb.db.delete(louezDb.apiEffects);

    const [cancelled, accepted] = await raceOnReservation<unknown>(id, [
      () =>
        statusChange
          .changeStoreReservationStatus(caller(), { id, to: "cancelled" })
          .then((change) => change.to),
      () => quotes.acceptQuote(STORE_SLUG, id),
    ]);
    assert.equal(cancelled, "cancelled");
    const state = await endState(id, productId);
    assert.equal(state.status, "cancelled");
    assert.equal(state.stock, 1);
    assert.equal(state.cancelled, 1);
    const won = typeof accepted === "object" && accepted !== null && "success" in accepted;
    assert.equal(state.confirmed, won ? 1 : 0);
    assert.equal(quoteMessages.length, won ? 1 : 0, "the customer heard of it once, or not at all");
    assert.equal(state.storeEffects, 1);
  });
});
