import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { sql } from "drizzle-orm";

import { createMemoryStorage } from "@louez/api/platform/memory-storage";
import { createTestNewStores } from "@louez/api/platform/test-new-stores";
import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The "needs a look" page's loader and its "Mark as handled", through the
// dashboard's inbox procedures on a migrated database: the page lists only
// the kinds it shows, each to who may read it; marking an item takes it off
// for the store; a caller that may not change what an item is about is refused.

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  mock.module(name, { namedExports: require(name) });
}

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@nal.test` } } : null;
        },
      },
    },
  },
});

const OWNER = "nal_owner_0000000001";
const STORE = "nal_store_0000000001";
const RESERVATION = "nal_reservation_0001";
const PAYMENT = "nal_payment_00000001";
const OPERATION = "nal_refund_op_000001";
const EFFECT = "nal_effect_000000001";

const ports = {
  planFeatures: async () => ({ apiAccess: true }),
  runReservationEffects: async () => {},
  insurance: { createContract: async () => null, cancelContract: async () => {} },
  newStores: createTestNewStores(),
  dispatchEffects: () => {},
  storage: createMemoryStorage(),
  urls: createTestUrls(),
  afterCommit: () => {},
  hostedBy: (): "lumycloud" | null => null,
  log: { error: () => {} },
};

describe("what needs a look (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let needsALook: typeof import("./needs-a-look");
  let inboxRouter: typeof import("@louez/api/router").appRouter.dashboard.inbox;
  let createRouterClient: typeof import("@orpc/server").createRouterClient;

  const session = () => ({
    headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${STORE}` }),
    transport: "rpc" as const,
    ports,
    receipt: {},
  });

  /** An API key with these rights, as an agent connects. */
  async function apiKey(permissions: Record<string, "none" | "read" | "write">) {
    const raw = `lz_test_${Math.random().toString(36).slice(2)}`;
    await louezDb.db.insert(louezDb.apiKeys).values({
      storeId: STORE,
      userId: OWNER,
      name: "Test agent",
      keyPrefix: "lz_test",
      keyHash: createHash("sha256").update(raw).digest("hex"),
      permissions: {
        reservations: "none",
        products: "none",
        customers: "none",
        categories: "none",
        payments: "none",
        analytics: "none",
        settings: "none",
        ...permissions,
      } as never,
    });
    return () => ({
      headers: new Headers({ authorization: `Bearer ${raw}` }),
      transport: "mcp" as const,
      ports,
      receipt: {},
    });
  }

  const inboxOf = (context: object) =>
    createRouterClient(inboxRouter, {
      context: context as never,
      path: ["dashboard", "inbox"],
    });

  before(async () => {
    database = await createTestDatabase("needs_a_look");
    louezDb = await import("@louez/db");
    needsALook = await import("./needs-a-look");
    inboxRouter = (await import("@louez/api/router")).appRouter.dashboard.inbox;
    createRouterClient = (await import("@orpc/server")).createRouterClient;
    const { db } = louezDb;

    await db.insert(louezDb.users).values({ id: OWNER, email: "owner@nal.test" });
    await db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Needs a look",
      slug: "needs-a-look",
      settings: { currency: "EUR", timezone: "Europe/Paris" } as never,
      onboardingCompleted: true,
      stripeAccountId: "acct_needs_a_look",
    });
    await db.insert(louezDb.storeMembers).values({ storeId: STORE, userId: OWNER, role: "owner" });
    await db.insert(louezDb.customers).values({
      id: "nal_customer_0000001",
      storeId: STORE,
      email: "camille@nal.test",
      firstName: "Camille",
      lastName: "Martin",
    });
    const reservation = (id: string, number: string, status: "confirmed" | "pending") =>
      db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: "nal_customer_0000001",
        number,
        status,
        startDate: new Date("2026-12-01T09:00:00Z"),
        endDate: new Date("2026-12-03T09:00:00Z"),
        subtotalAmount: "100.00",
        depositAmount: "0.00",
        totalAmount: "100.00",
        currency: "EUR",
      });
    await reservation(RESERVATION, "R-1", "confirmed");
    // A booking request: daily work, shown elsewhere, never on this page.
    await reservation("nal_reservation_0002", "R-2", "pending");
    await db.insert(louezDb.payments).values({
      id: PAYMENT,
      reservationId: RESERVATION,
      amount: "100.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      stripePaymentIntentId: "pi_nal",
      stripeChargeId: "ch_nal",
      currency: "EUR",
      grossMinor: 10_000,
    });
    // A refund Stripe has not confirmed a day after it was asked.
    await db.insert(louezDb.paymentRefundOperations).values({
      id: OPERATION,
      storeId: STORE,
      reservationId: RESERVATION,
      paymentId: PAYMENT,
      stripeAccountId: "acct_needs_a_look",
      stripeChargeId: "ch_nal",
      amountMinor: 3_000,
      currency: "EUR",
      refundType: "rental",
      reason: "requested_by_customer",
      status: "requested",
      createdAt: sql`NOW() - INTERVAL 25 HOUR`,
    });
    // A customer message the outbox gave up on.
    await db.insert(louezDb.apiEffects).values({
      id: EFFECT,
      storeId: STORE,
      reservationId: RESERVATION,
      type: "reservation.customerMessage",
      payload: { channel: "email", notification: "customer_request_accepted" },
      status: "abandoned",
      attempts: 8,
      lastError: "Abandoned: recipient_changed: the address changed",
      nextAttemptAt: sql`NOW() - INTERVAL 1 HOUR`,
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("the owner's page lists the kinds that need a look, and no daily work", async () => {
    const loaded = await needsALook.loadNeedsALook(inboxOf(session()));
    assert.deepEqual(loaded.items.map((item) => item.type).sort(), [
      "message_not_sent",
      "refund_unconfirmed",
    ]);
    assert.equal(loaded.more, false);
    assert.equal(loaded.incomplete, false);
    assert.deepEqual(needsALook.needsALookCount(loaded), { count: 2, capped: false });
    const refund = loaded.items.find((item) => item.type === "refund_unconfirmed");
    assert.equal(refund?.details.amount, "30.00");
    assert.equal(refund?.details.currency, "EUR");
  });

  test("a caller without payments access sees no money item; one with neither, nothing", async () => {
    const noPayments = await apiKey({ reservations: "read", customers: "read" });
    const loaded = await needsALook.loadNeedsALook(inboxOf(noPayments()));
    assert.deepEqual(
      loaded.items.map((item) => item.type),
      ["message_not_sent"],
    );
    // The page's line counts what the caller may see.
    assert.deepEqual(needsALook.needsALookCount(loaded), { count: 1, capped: false });

    const productsOnly = await apiKey({ products: "read" });
    assert.deepEqual((await needsALook.loadNeedsALook(inboxOf(productsOnly()))).items, []);
  });

  test("a caller that may not change payments is refused marking a refund handled", async () => {
    const readsPayments = await apiKey({ reservations: "write", payments: "read" });
    const [refund] = (await needsALook.loadNeedsALook(inboxOf(readsPayments()))).items.filter(
      (item) => item.type === "refund_unconfirmed",
    );
    assert.ok(refund);
    await assert.rejects(
      needsALook.acknowledgeNeedsALook(inboxOf(readsPayments()), refund),
      (error: { code?: string; data?: { code?: string } }) =>
        (error.data?.code ?? error.code) === "PERMISSION_DENIED",
    );
    // Still there for everyone.
    const again = await needsALook.loadNeedsALook(inboxOf(session()));
    assert.ok(again.items.some((item) => item.id === refund.id));
  });

  test("the owner marks an item handled: it leaves the page; an outdated one reads as changed", async () => {
    const before_ = await needsALook.loadNeedsALook(inboxOf(session()));
    const message = before_.items.find((item) => item.type === "message_not_sent");
    assert.ok(message);

    // An occurrence the inbox no longer holds: nothing is marked, the list is read again.
    assert.equal(
      await needsALook.acknowledgeNeedsALook(inboxOf(session()), {
        id: message.id,
        occurredAt: new Date(new Date(message.occurredAt).getTime() - 60_000),
      }),
      "changed",
    );

    assert.equal(await needsALook.acknowledgeNeedsALook(inboxOf(session()), message), "handled");
    const after_ = await needsALook.loadNeedsALook(inboxOf(session()));
    assert.deepEqual(
      after_.items.map((item) => item.type),
      ["refund_unconfirmed"],
    );
    // Marked for the store: an agent no longer sees it either.
    const agent = await apiKey({ reservations: "read", payments: "read" });
    assert.ok(
      (await needsALook.loadNeedsALook(inboxOf(agent()))).items.every(
        (item) => item.id !== message.id,
      ),
    );
  });
});
