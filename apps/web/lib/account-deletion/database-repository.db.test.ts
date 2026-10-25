import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The purge changes other stores' billing snapshots, and marks them in its
// transaction (louez-billing docs/api, README §5.2). The deleted store's own final
// snapshots come later (§5.5).

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
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  test("marks the other stores whose snapshots change, never the deleted one", async () => {
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
      })
      .from(queueTable)
      .orderBy(queueTable.aggregateType, queueTable.aggregateId);
    assert.deepEqual(rows, [
      { type: "store", id: REFERRED_BY_USER, version: 1 },
      { type: "store", id: CO_OWNED, version: 1 },
      { type: "store", id: REFERRED, version: 1 },
      { type: "legacy_store", id: REFERRER, version: 1 },
    ]);
  });
});
