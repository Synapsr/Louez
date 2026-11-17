import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { StoreSettings } from "@louez/types";

import { STORE_KEY } from "@/app/(dashboard)/dashboard/reservations/actions-test-stubs";
import {
  createTestDatabase,
  readLockWaiters,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type LockWaiter,
  type RowLock,
  type TestDatabase,
} from "@louez/db/testing";

// The purge changes other stores' billing snapshots, and marks them in its
// transaction (louez-billing docs/api, README §5.2). It also writes the deleted
// store's final snapshot (§5.5, final-snapshots.db.test.ts covers its reservations),
// the queue rows outlive the store, and a reservation it purges without a final
// snapshot is raised once it commits. It takes its stores' products before their
// reservations, as a status change that moves stock does, and as the unit
// assignment, the move to another unit and the automatic extension do: each races
// the purge of its store in both orders, its row locks read while it waits.

// The repository imports "server-only", which throws outside Next. What the
// product page's actions and the extension call besides the database (the
// session, the page cache, the contract, the invoice, the calendar, the e-mails)
// has no runtime in a test; the reservation actions get theirs from
// actions-test-stubs.
const STUBS: Record<string, string> = {
  "next/cache": "export function revalidatePath() {}\n",
  "@/lib/auth": "export async function auth() { return null; }\n",
  "@/lib/store-context": `export async function getCurrentStore() { return globalThis[${JSON.stringify(STORE_KEY)}] ?? null; }\n`,
  "@/lib/pdf/generate": "export async function generateContract() {}\n",
  "@/lib/invoicing/service":
    "export async function tryGenerateInvoiceForPayment() { return {}; }\n",
  "@/lib/integrations/calendar/sync": "export async function markReservationForCalendarSync() {}\n",
  "@/lib/email/send": "export async function sendReservationModifiedEmail() {}\n",
};
const STUBBED_PARENTS = [
  "/dashboard/products/[id]/actions.ts",
  "/lib/reservations/extension-service.ts",
];
const STUB_SCHEME = "louez-purge-writers-test:";
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (STUBBED_PARENTS.some((file) => parent.endsWith(file)) && specifier in STUBS) {
      return { shortCircuit: true, url: `${STUB_SCHEME}${specifier}` };
    }
    return next(specifier, context);
  },
  load(url: string, context: unknown, next: (url: string, context: unknown) => unknown) {
    if (!url.startsWith(STUB_SCHEME)) return next(url, context);
    return { shortCircuit: true, format: "module", source: STUBS[url.slice(STUB_SCHEME.length)] };
  },
});

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";
// The alert claims its Discord slot in billing_sync_state; nothing is posted.
process.env.DISCORD_ADMIN_WEBHOOK_URL = "";

const USER = "user_purge_marks";
const OTHER_USER = "user_purge_other";
const DELETED = "store_purge_deleted";
/** Signed up through the deleted store's referral link. */
const REFERRED = "store_purge_referred";
/** Signed up through the deleted user's link without a store. */
const REFERRED_BY_USER = "store_purge_by_user";
/** Referred the deleted store and loses that reward. */
const REFERRER = "store_purge_referrer";
const CO_OWNED = "store_purge_co_owned";
const MEMBER_ONLY = "store_purge_member";
/** The race tests run after the first one, which reads every queue row. */
const RACE_REFERRER_USER = "user_race_referrer";
const RACE_PAYING_USER = "user_race_paying";
const RACE_DELETED_REFERRER = "store_race_referrer";
const RACE_SURVIVING = "store_race_referred";
const RACE_PAYING_STORE = "store_race_paying";
const RACE_RESERVATION = "res_race";
const RACE_PAYMENT = "pay_race";
const RACE_SMS_USER = "user_race_sms";
const RACE_SMS_STORE = "store_race_sms";
const RACE_SMS_TOPUP = "topup_race_sms_00001";

describe("account deletion billing marks (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let repository: typeof import("./database-repository");
  let assignment: typeof import("@/app/(dashboard)/dashboard/reservations/actions");
  let move: typeof import("@/app/(dashboard)/dashboard/products/[id]/actions");
  let extension: typeof import("@/lib/reservations/extension-service");

  before(async () => {
    database = await createTestDatabase("purge_marks");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    repository = await import("./database-repository");
    assignment = await import("@/app/(dashboard)/dashboard/reservations/actions");
    move = await import("@/app/(dashboard)/dashboard/products/[id]/actions");
    extension = await import("@/lib/reservations/extension-service");

    await louezDb.db.insert(louezDb.users).values([
      { id: USER, email: "leaving@example.test" },
      { id: OTHER_USER, email: "staying@example.test" },
    ]);
    const store = (id: string, userId: string, referral: object = {}) => ({
      id,
      userId,
      name: id,
      slug: id.replace(/_/g, "-"),
      ...referral,
    });
    await louezDb.db
      .insert(louezDb.stores)
      .values([
        store(DELETED, USER, { referredByStoreId: REFERRER }),
        store(REFERRED, OTHER_USER, { referredByStoreId: DELETED, referredByUserId: USER }),
        store(REFERRED_BY_USER, OTHER_USER, { referredByUserId: USER }),
        store(REFERRER, OTHER_USER),
        store(CO_OWNED, OTHER_USER),
        store(MEMBER_ONLY, OTHER_USER),
      ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: DELETED, userId: USER, role: "owner" },
      { storeId: CO_OWNED, userId: OTHER_USER, role: "owner" },
      { storeId: CO_OWNED, userId: USER, role: "owner" },
      { storeId: MEMBER_ONLY, userId: OTHER_USER, role: "owner" },
      { storeId: MEMBER_ONLY, userId: USER, role: "member" },
    ]);
    const reward = (referrerStoreId: string, referredStoreId: string) => ({
      referrerStoreId,
      referredStoreId,
      qualifyingReservationId: "reservation",
      qualifyingAmountCents: 5000,
      kind: "free_reservations" as const,
      freeReservations: 5,
      grantedMonth: "2026-10",
    });
    await louezDb.db
      .insert(louezDb.referralRewards)
      .values([reward(REFERRER, DELETED), reward(DELETED, REFERRED)]);
    // More payments than the contract allows: no final snapshot can be built for it.
    await louezDb.db.insert(louezDb.reservations).values({
      id: "res_purge_too_many",
      storeId: DELETED,
      customerId: "customer_purge",
      number: "R-PURGE-1",
      status: "completed",
      startDate: new Date("2026-09-10T09:00:00Z"),
      endDate: new Date("2026-09-12T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
    });
    await louezDb.db.insert(louezDb.payments).values(
      Array.from({ length: 201 }, (_, index) => ({
        id: `p_purge_many_${index}`,
        reservationId: "res_purge_too_many",
        amount: "0.00",
        type: "rental" as const,
        method: "stripe" as const,
        status: "cancelled" as const,
        stripeCheckoutSessionId: `cs_purge_many_${index}`,
      })),
    );
    // A queued customer message names the customer: it goes with the store.
    await louezDb.db.insert(louezDb.apiEffects).values([
      {
        id: "fx_purge_deleted_0001",
        storeId: DELETED,
        reservationId: "res_purge_too_many",
        type: "reservation.customerMessage",
        payload: { customer: { email: "renter@example.test" } },
      },
      {
        id: "fx_purge_kept_0000001",
        storeId: CO_OWNED,
        type: "reservation.statusAnalytics",
        payload: {},
      },
    ]);
  });

  after(async () => {
    Reflect.deleteProperty(globalThis, STORE_KEY);
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("marks the other stores whose snapshots change, and closes the deleted one", async () => {
    const context = await repository.accountDeletionRepository.getContext(USER);
    assert.ok(context, "the user exists");

    const result = await repository.accountDeletionRepository.purgeOwnedData(context, {
      beforePurge: async () => undefined,
    });

    assert.equal(result.storesDeleted, 1);
    const { billingSyncQueue: queueTable } = louezDb;
    const rows = await louezDb.db
      .select({
        type: queueTable.aggregateType,
        id: queueTable.aggregateId,
        version: queueTable.version,
        final: queueTable.finalPayload,
      })
      .from(queueTable)
      .orderBy(queueTable.aggregateType, queueTable.aggregateId);
    const deletedRow = rows.find((row) => row.id === DELETED);
    assert.deepEqual(
      rows.map(({ type, id, version, final }) => ({ type, id, version, final: final !== null })),
      [
        { type: "store", id: REFERRED_BY_USER, version: 1, final: false },
        { type: "store", id: CO_OWNED, version: 1, final: false },
        { type: "store", id: DELETED, version: 1, final: true },
        { type: "store", id: REFERRED, version: 1, final: false },
        { type: "legacy_store", id: REFERRER, version: 1, final: false },
      ],
    );
    const payload = z
      .object({ data: z.object({ deleted: z.boolean(), finalReservations: z.array(z.unknown()) }) })
      .parse(deletedRow?.final);
    assert.deepEqual(payload.data, { ...payload.data, deleted: true, finalReservations: [] });
    const stores = await louezDb.db
      .select({ id: louezDb.stores.id })
      .from(louezDb.stores)
      .where(eq(louezDb.stores.id, DELETED));
    assert.deepEqual(stores, [], "the store itself is gone");
    const effects = await louezDb.db.select({ id: louezDb.apiEffects.id }).from(louezDb.apiEffects);
    assert.deepEqual(
      effects.map((row) => row.id),
      ["fx_purge_kept_0000001"],
      "the deleted store's outbox rows went with it, another store's stayed",
    );

    // The reservation went without a final snapshot: the committed purge alerted.
    const [state] = await louezDb.db
      .select({ alerts: louezDb.billingSyncState.alerts })
      .from(louezDb.billingSyncState);
    const alerts = z.record(z.string(), z.string()).parse(state?.alerts);
    assert.ok(alerts.final_snapshot_skipped, "the skipped reservation was alerted");
  });

  /** Resolves once a transaction on this test's database waits for a row lock. */
  async function lockWait(): Promise<void> {
    const waiting = z.array(z.object({ waiting: z.coerce.number() }));
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [rows] = await louezDb.db.execute(
        sql`SELECT COUNT(*) AS waiting FROM performance_schema.data_locks
            WHERE OBJECT_SCHEMA = DATABASE() AND LOCK_STATUS = 'WAITING'`,
      );
      if ((waiting.parse(rows)[0]?.waiting ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("no transaction waited for a lock");
  }

  /** "committed", or the driver's error, such as a deadlock. */
  const settle = (promise: Promise<unknown>) =>
    promise.then(
      () => "committed",
      (error: unknown) => {
        const cause = error instanceof Error ? error.cause : undefined;
        if (cause instanceof Error) return cause.message;
        return error instanceof Error ? error.message : String(error);
      },
    );

  test("a store update that marks after writing does not deadlock with the purge", async () => {
    await louezDb.db
      .insert(louezDb.users)
      .values([{ id: RACE_REFERRER_USER, email: "race-referrer@example.test" }]);
    await louezDb.db.insert(louezDb.stores).values([
      {
        id: RACE_DELETED_REFERRER,
        userId: RACE_REFERRER_USER,
        name: "Referrer",
        slug: "race-referrer",
      },
      {
        id: RACE_SURVIVING,
        userId: OTHER_USER,
        name: "Referred",
        slug: "race-referred",
        referredByStoreId: RACE_DELETED_REFERRER,
      },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: RACE_DELETED_REFERRER, userId: RACE_REFERRER_USER, role: "owner" },
      { storeId: RACE_SURVIVING, userId: OTHER_USER, role: "owner" },
    ]);
    const context = await repository.accountDeletionRepository.getContext(RACE_REFERRER_USER);
    assert.ok(context, "the user exists");
    let writer: Promise<string> = Promise.resolve("not started");

    const purge = settle(
      repository.accountDeletionRepository.purgeOwnedData(context, {
        beforePurge: async () => {
          let holding: () => void = () => undefined;
          const held = new Promise<void>((resolve) => {
            holding = resolve;
          });
          // A settings save on the referred store: its row first, its queue row last.
          writer = settle(
            louezDb.db.transaction(async (tx) => {
              await tx
                .update(louezDb.stores)
                .set({ name: "Referred, renamed" })
                .where(eq(louezDb.stores.id, RACE_SURVIVING));
              holding();
              await lockWait();
              await louezDb.markStore(tx, RACE_SURVIVING);
            }),
          );
          await held;
        },
      }),
    );

    assert.deepEqual(
      { purge: await purge, writer: await writer },
      { purge: "committed", writer: "committed" },
    );
    const [row] = await louezDb.db
      .select({ version: louezDb.billingSyncQueue.version })
      .from(louezDb.billingSyncQueue)
      .where(eq(louezDb.billingSyncQueue.aggregateId, RACE_SURVIVING));
    assert.equal(row?.version, 2, "marked by the save, then by the purge");
  });

  test("a payment write that commits during the purge is in the closing snapshot", async () => {
    await louezDb.db
      .insert(louezDb.users)
      .values([{ id: RACE_PAYING_USER, email: "race-paying@example.test" }]);
    await louezDb.db
      .insert(louezDb.stores)
      .values([
        { id: RACE_PAYING_STORE, userId: RACE_PAYING_USER, name: "Paying", slug: "race-paying" },
      ]);
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values([{ storeId: RACE_PAYING_STORE, userId: RACE_PAYING_USER, role: "owner" }]);
    await louezDb.db.insert(louezDb.reservations).values({
      id: RACE_RESERVATION,
      storeId: RACE_PAYING_STORE,
      customerId: "customer_race",
      number: "R-RACE-1",
      status: "confirmed",
      billableAt: new Date("2026-10-01T08:00:00Z"),
      startDate: new Date("2026-10-10T09:00:00Z"),
      endDate: new Date("2026-10-12T09:00:00Z"),
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
    });
    await louezDb.db.insert(louezDb.payments).values({
      id: RACE_PAYMENT,
      reservationId: RACE_RESERVATION,
      amount: "100.00",
      type: "rental",
      method: "cash",
      status: "completed",
      paidAt: new Date("2026-10-01T08:00:00Z"),
    });
    const context = await repository.accountDeletionRepository.getContext(RACE_PAYING_USER);
    assert.ok(context, "the user exists");
    let holding: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    // A refund nets the payment: the payment row first, its reservation's queue row last.
    const writer = settle(
      louezDb.db.transaction(async (tx) => {
        await tx
          .update(louezDb.payments)
          .set({ amount: "40.00" })
          .where(eq(louezDb.payments.id, RACE_PAYMENT));
        await louezDb.markReservation(tx, { id: RACE_RESERVATION, storeId: RACE_PAYING_STORE });
        holding();
        await lockWait();
      }),
    );
    await held;

    const purge = settle(
      repository.accountDeletionRepository.purgeOwnedData(context, {
        beforePurge: async () => undefined,
      }),
    );

    assert.deepEqual(
      { purge: await purge, writer: await writer },
      { purge: "committed", writer: "committed" },
    );
    const [row] = await louezDb.db
      .select({ final: louezDb.billingSyncQueue.finalPayload })
      .from(louezDb.billingSyncQueue)
      .where(eq(louezDb.billingSyncQueue.aggregateId, RACE_RESERVATION));
    const payload = z
      .object({ data: z.object({ payments: z.array(z.object({ grossMinor: z.number() })) }) })
      .parse(row?.final);
    assert.deepEqual(
      payload.data.payments.map((payment) => payment.grossMinor),
      [4000],
    );
  });

  test("a top-up being credited does not deadlock with the purge of its store's SMS", async () => {
    await louezDb.db
      .insert(louezDb.users)
      .values([{ id: RACE_SMS_USER, email: "race-sms@example.test" }]);
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: RACE_SMS_STORE, userId: RACE_SMS_USER, name: "SMS", slug: "race-sms" });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: RACE_SMS_STORE, userId: RACE_SMS_USER, role: "owner" });
    await louezDb.db.insert(louezDb.smsCredits).values({ storeId: RACE_SMS_STORE, balance: 5 });
    await louezDb.db.insert(louezDb.smsTopupTransactions).values({
      id: RACE_SMS_TOPUP,
      storeId: RACE_SMS_STORE,
      quantity: 5,
      unitPriceCents: 10,
      totalAmountCents: 50,
      status: "pending",
    });
    // An SMS sent on an empty balance: the top-up pays its credit.
    await louezDb.db.insert(louezDb.smsLogs).values({
      storeId: RACE_SMS_STORE,
      to: "+33612345678",
      message: "SMS",
      templateType: "reservation_cancelled",
      status: "sent",
      creditSource: "topup_unpaid",
    });
    const { collectUnpaidSmsCredits } = await import("@/lib/sms/delivery-record");
    const context = await repository.accountDeletionRepository.getContext(RACE_SMS_USER);
    assert.ok(context, "the user exists");
    let topup: Promise<string> = Promise.resolve("not started");

    const purge = settle(
      repository.accountDeletionRepository.purgeOwnedData(context, {
        beforePurge: async () => {
          let holding: () => void = () => undefined;
          const held = new Promise<void>((resolve) => {
            holding = resolve;
          });
          // The top-up's credit, in the SMS lock order: the top-up row, then
          // (once the purge waits) the credits and the logs.
          topup = settle(
            louezDb.db.transaction(async (tx) => {
              await tx
                .select({ id: louezDb.smsTopupTransactions.id })
                .from(louezDb.smsTopupTransactions)
                .where(eq(louezDb.smsTopupTransactions.id, RACE_SMS_TOPUP))
                .for("update");
              holding();
              await lockWait();
              await collectUnpaidSmsCredits(tx, RACE_SMS_STORE);
            }),
          );
          await held;
        },
      }),
    );

    assert.deepEqual(
      { purge: await purge, topup: await topup },
      { purge: "committed", topup: "committed" },
    );
    const left = await louezDb.db
      .select({ id: louezDb.smsLogs.id })
      .from(louezDb.smsLogs)
      .where(eq(louezDb.smsLogs.storeId, RACE_SMS_STORE));
    assert.deepEqual(left, [], "the store's SMS went with it");
  });

  test("a status change that moves stock and the purge of its store, at once: one after the other, no deadlock nor restart, billing sync off and on", async () => {
    const hooks = reservationChangeTestHooks();
    for (const billing of ["off", "on"] as const) {
      const userId = `user_race_stock_${billing}`;
      const storeId = `store_race_stock_${billing}`;
      const productId = `prd_race_stock_${billing}`;
      const reservationId = `res_race_stock_${billing}`;
      await louezDb.db
        .insert(louezDb.users)
        .values({ id: userId, email: `race-stock-${billing}@example.test` });
      await louezDb.db
        .insert(louezDb.stores)
        .values({ id: storeId, userId, name: "Stock", slug: `race-stock-${billing}` });
      await louezDb.db.insert(louezDb.storeMembers).values({ storeId, userId, role: "owner" });
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId,
        name: "Consumable",
        price: "1.00",
        pricingMode: "day",
        stockKind: "consumable",
        quantity: 5,
      });
      await louezDb.db.insert(louezDb.reservations).values({
        id: reservationId,
        storeId,
        customerId: "customer_race_stock",
        number: `R-STOCK-${billing}`,
        status: "pending",
        startDate: new Date("2026-11-20T09:00:00Z"),
        endDate: new Date("2026-11-22T09:00:00Z"),
        subtotalAmount: "2.00",
        depositAmount: "0.00",
        totalAmount: "2.00",
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: `itm_race_stock_${billing}`,
        reservationId,
        productId,
        quantity: 2,
        unitPrice: "1.00",
        depositPerUnit: "0.00",
        totalPrice: "2.00",
        productSnapshot: { name: "Consumable", description: null, images: [] },
      });
      const context = await repository.accountDeletionRepository.getContext(userId);
      assert.ok(context, "the user exists");
      if (billing === "off") process.env.LOUEZ_BILLING = "";
      hooks.restarts = 0;
      let purge: Promise<string> = Promise.resolve("not started");
      try {
        // The confirmation holds the product's lock when it reaches the reservation's:
        // the purge starts then, and the confirmation goes on once the purge waits.
        hooks.beforeReservationLock = async (scope) => {
          if (scope.reservationId !== reservationId) return;
          // Once: a run that starts over finds the purge started.
          hooks.beforeReservationLock = null;
          purge = settle(
            repository.accountDeletionRepository.purgeOwnedData(context, {
              beforePurge: async () => undefined,
            }),
          );
          await lockWait();
        };
        const change = await settle(
          louezDb.runReservationChange({ reservationId, storeId }, (tx, lock) =>
            louezDb.changeReservationStatus(tx, {
              reservationId,
              storeId,
              to: "confirmed",
              actor: "store_user",
              actorUserId: null,
              lock,
            }),
          ),
        );

        assert.deepEqual(
          { change, purge: await purge, restarts: hooks.restarts },
          { change: "committed", purge: "committed", restarts: 0 },
          `billing sync ${billing}`,
        );
      } finally {
        hooks.beforeReservationLock = null;
        process.env.LOUEZ_BILLING = "cloud";
      }
      const left = await Promise.all([
        louezDb.db
          .select({ id: louezDb.reservations.id })
          .from(louezDb.reservations)
          .where(eq(louezDb.reservations.id, reservationId)),
        louezDb.db
          .select({ id: louezDb.products.id })
          .from(louezDb.products)
          .where(eq(louezDb.products.id, productId)),
        louezDb.db
          .select({ id: louezDb.stores.id })
          .from(louezDb.stores)
          .where(eq(louezDb.stores.id, storeId)),
      ]);
      assert.deepEqual(left, [[], [], []], `billing sync ${billing}: the store went whole`);
    }
  });

  // The writers that are not status changes, against the purge of their store.
  const WRITER_SETTINGS: StoreSettings = {
    reservationMode: "request",
    advanceNoticeMinutes: 0,
    currency: "EUR",
  };
  /** The extension's new end, as the customer's form sends it, in the store's zone (UTC). */
  const EXTENDED_END = "2030-06-04T09:00";
  let writerCounter = 0;
  // 21 characters, as nanoid ids: the actions check their shape.
  const writerId = (prefix: string) =>
    `${prefix}_${String(++writerCounter).padStart(20 - prefix.length, "0")}`;

  /**
   * A store of its own user, a product of three units, and a confirmed
   * reservation of one line that holds the first unit. The session's store is
   * this one, for the dashboard's actions.
   */
  async function writerFixture() {
    const userId = writerId("usr");
    const storeId = writerId("sto");
    const customerId = writerId("cus");
    const productId = writerId("prd");
    const reservationId = writerId("res");
    const itemId = writerId("itm");
    const units = [writerId("unt"), writerId("unt"), writerId("unt")];
    await louezDb.db.insert(louezDb.users).values({ id: userId, email: `${userId}@example.test` });
    await louezDb.db.insert(louezDb.stores).values({
      id: storeId,
      userId,
      name: "Writers",
      slug: storeId.replace(/_/g, "-"),
      settings: WRITER_SETTINGS,
    });
    await louezDb.db.insert(louezDb.storeMembers).values({ storeId, userId, role: "owner" });
    await louezDb.db.insert(louezDb.customers).values({
      id: customerId,
      storeId,
      email: `${customerId}@example.test`,
      firstName: "Renter",
      lastName: "Test",
    });
    await louezDb.db.insert(louezDb.products).values({
      id: productId,
      storeId,
      name: "Tracked",
      price: "0.00",
      pricingMode: "day",
      trackUnits: true,
      quantity: 3,
    });
    for (const [index, unitId] of units.entries()) {
      await louezDb.db
        .insert(louezDb.productUnits)
        .values({ id: unitId, productId, identifier: `U-${index + 1}` });
    }
    // A fixture, so it may start confirmed.
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId,
      customerId,
      number: reservationId,
      status: "confirmed",
      startDate: new Date("2030-06-01T09:00:00.000Z"),
      endDate: new Date("2030-06-03T09:00:00.000Z"),
      subtotalAmount: "0.00",
      depositAmount: "0.00",
      totalAmount: "0.00",
      source: "online",
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: itemId,
      reservationId,
      productId,
      quantity: 1,
      unitPrice: "0.00",
      depositPerUnit: "0.00",
      totalPrice: "0.00",
      productSnapshot: { name: "Tracked", description: null, images: [] },
    });
    await louezDb.db.insert(louezDb.reservationItemUnits).values({
      id: writerId("asg"),
      reservationItemId: itemId,
      productUnitId: units[0] ?? "",
      identifierSnapshot: units[0] ?? "",
    });
    Reflect.set(globalThis, STORE_KEY, {
      id: storeId,
      userId: "",
      name: "Writers",
      slug: storeId.replace(/_/g, "-"),
      address: null,
      settings: WRITER_SETTINGS,
      stripeAccountId: null,
    });
    const context = await repository.accountDeletionRepository.getContext(userId);
    assert.ok(context, "the user exists");
    return { userId, storeId, customerId, productId, reservationId, itemId, units, context };
  }
  type WriterFixture = Awaited<ReturnType<typeof writerFixture>>;

  /** What a call ended with, without an unhandled rejection while it waits. */
  const outcome = <T>(call: Promise<T>) =>
    call.then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );

  /**
   * Holds the reservation's row while `first` waits for a lock, then while
   * `second` waits too, then lets them go: `first` was queued first. Returns
   * what each ended with, and the row locks each held, and waited for, while
   * it waited.
   */
  async function raceInOrder<A, B>(
    reservationId: string,
    first: () => Promise<A>,
    second: () => Promise<B>,
  ) {
    const holder = await database.connect();
    try {
      await holder.beginTransaction();
      await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [reservationId]);
      const firstRun = outcome(first());
      await waitForLockWaits(holder, database.name, 1);
      const [firstLocks] = await readLockWaiters(holder, database.name);
      const secondRun = outcome(second());
      await waitForLockWaits(holder, database.name, 2);
      const secondLocks: LockWaiter | undefined = (
        await readLockWaiters(holder, database.name)
      ).find((waiter) => waiter.transactionId !== firstLocks?.transactionId);
      await holder.commit();
      // Asserted once both calls have ended, so a failing race leaves none running.
      const raced = { first: await firstRun, second: await secondRun };
      assert.ok(firstLocks && secondLocks, "both callers waited on a lock");
      return {
        first: { ...raced.first, locks: firstLocks },
        second: { ...raced.second, locks: secondLocks },
      };
    } finally {
      await holder.end();
    }
  }

  const rowsOf = (locks: RowLock[], table: RowLock["table"]) =>
    locks.filter((lock) => lock.table === table).map((lock) => lock.id);

  /** The answer of a writer that went through: the actions answer success, the extension its status. */
  const succeeded = (answer: unknown) =>
    typeof answer === "object" &&
    answer !== null &&
    (("success" in answer && answer.success === true) ||
      ("status" in answer && answer.status === "confirmed"));

  const notFound = (answer: unknown) =>
    JSON.stringify(answer) === JSON.stringify({ error: "errors.notFound" });

  /** What is left of the fixture's store: nothing, once the purge committed. */
  async function leftOf(fixture: WriterFixture) {
    const [stores, products, reservations, units] = await Promise.all([
      louezDb.db
        .select({ id: louezDb.stores.id })
        .from(louezDb.stores)
        .where(eq(louezDb.stores.id, fixture.storeId)),
      louezDb.db
        .select({ id: louezDb.products.id })
        .from(louezDb.products)
        .where(eq(louezDb.products.id, fixture.productId)),
      louezDb.db
        .select({ id: louezDb.reservations.id })
        .from(louezDb.reservations)
        .where(eq(louezDb.reservations.id, fixture.reservationId)),
      louezDb.db
        .select({ id: louezDb.productUnits.id })
        .from(louezDb.productUnits)
        .where(eq(louezDb.productUnits.productId, fixture.productId)),
    ]);
    return { stores, products, reservations, units };
  }

  const WRITERS: Array<{
    writer: string;
    run: (fixture: WriterFixture) => Promise<unknown>;
    /** Whether the writer answered not found: the purge took its reservation away. */
    gone: (answer: { value?: unknown; error?: unknown }) => boolean;
  }> = [
    {
      writer: "the unit assignment",
      run: ({ itemId, units }) => assignment.assignUnitsToReservationItem(itemId, [units[1] ?? ""]),
      gone: (answer) => notFound(answer.value),
    },
    {
      writer: "the move to another unit",
      run: ({ itemId, units }) =>
        move.reassignReservationItemUnit({
          reservationItemId: itemId,
          fromUnitId: units[0] ?? "",
          toUnitId: units[2] ?? "",
        }),
      gone: (answer) => notFound(answer.value),
    },
    {
      writer: "the automatic extension",
      run: ({ storeId, customerId, reservationId }) =>
        extension.startExtension({
          storeId,
          customerId,
          reservationId,
          endDate: EXTENDED_END,
          expectedSupplement: 0,
        }),
      // The extension throws its refusals.
      gone: (answer) => answer.error instanceof Error && answer.error.message === "notFound",
    },
  ];

  for (const { writer, run, gone } of WRITERS) {
    test(`${writer}, queued first: it holds its product while it waits for the reservation, the purge waits for that product, then deletes what it wrote`, async () => {
      const hooks = reservationChangeTestHooks();
      for (const billing of ["off", "on"] as const) {
        const fixture = await writerFixture();
        if (billing === "off") process.env.LOUEZ_BILLING = "";
        hooks.restarts = 0;
        try {
          const raced = await raceInOrder(
            fixture.reservationId,
            () => run(fixture),
            () =>
              repository.accountDeletionRepository.purgeOwnedData(fixture.context, {
                beforePurge: async () => undefined,
              }),
          );
          const label = `billing sync ${billing}`;
          // The writer: its product held, the reservation awaited.
          assert.deepEqual(rowsOf(raced.first.locks.holds, "products"), [fixture.productId], label);
          assert.deepEqual(
            rowsOf(raced.first.locks.waitsFor, "reservations"),
            [fixture.reservationId],
            label,
          );
          // The purge: behind it on the product, no reservation of the store held.
          assert.deepEqual(
            rowsOf(raced.second.locks.waitsFor, "products"),
            [fixture.productId],
            label,
          );
          assert.deepEqual(rowsOf(raced.second.locks.holds, "reservations"), [], label);
          assert.ok("value" in raced.first && succeeded(raced.first.value), `${label}: ${writer}`);
          assert.ok("value" in raced.second, `${label}: the purge committed`);
          assert.equal(hooks.restarts, 0, `${label}: no run started over`);
          assert.deepEqual(
            await leftOf(fixture),
            { stores: [], products: [], reservations: [], units: [] },
            label,
          );
        } finally {
          process.env.LOUEZ_BILLING = "cloud";
        }
      }
    });

    test(`${writer}, queued second: the purge holds the store's product while it waits for the reservation, the writer waits for that product holding no reservation, then finds nothing`, async () => {
      const hooks = reservationChangeTestHooks();
      for (const billing of ["off", "on"] as const) {
        const fixture = await writerFixture();
        if (billing === "off") process.env.LOUEZ_BILLING = "";
        hooks.restarts = 0;
        try {
          const raced = await raceInOrder(
            fixture.reservationId,
            () =>
              repository.accountDeletionRepository.purgeOwnedData(fixture.context, {
                beforePurge: async () => undefined,
              }),
            () => run(fixture),
          );
          const label = `billing sync ${billing}`;
          // The purge: the store's product held, the reservation awaited.
          assert.deepEqual(rowsOf(raced.first.locks.holds, "products"), [fixture.productId], label);
          assert.deepEqual(
            rowsOf(raced.first.locks.waitsFor, "reservations"),
            [fixture.reservationId],
            label,
          );
          // The writer: behind the purge on the product, no reservation held.
          assert.deepEqual(
            rowsOf(raced.second.locks.waitsFor, "products"),
            [fixture.productId],
            label,
          );
          assert.deepEqual(rowsOf(raced.second.locks.holds, "reservations"), [], label);
          assert.ok("value" in raced.first, `${label}: the purge committed`);
          assert.ok(
            gone(raced.second),
            `${label}: ${writer} answered ${JSON.stringify("value" in raced.second ? raced.second.value : String(raced.second.error))}`,
          );
          assert.equal(hooks.restarts, 0, `${label}: no run started over`);
          assert.deepEqual(
            await leftOf(fixture),
            { stores: [], products: [], reservations: [], units: [] },
            label,
          );
        } finally {
          process.env.LOUEZ_BILLING = "cloud";
        }
      }
    });
  }
});
