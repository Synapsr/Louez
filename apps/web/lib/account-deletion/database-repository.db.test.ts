import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The purge changes other stores' billing snapshots, and marks them in its
// transaction (louez-billing docs/api, README §5.2). It also writes the deleted
// store's final snapshot (§5.5, final-snapshots.db.test.ts covers its reservations),
// the queue rows outlive the store, and a reservation it purges without a final
// snapshot is raised once it commits.

// The repository imports "server-only", which throws outside Next.
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
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

describe("account deletion billing marks (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let repository: typeof import("./database-repository");

  before(async () => {
    database = await createTestDatabase("purge_marks");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    repository = await import("./database-repository");

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
  });

  after(async () => {
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
});
