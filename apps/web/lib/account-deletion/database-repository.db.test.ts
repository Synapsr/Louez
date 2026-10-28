import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
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
});
