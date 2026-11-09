import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { ScopedActor } from "./actor";

// The records of writes past their retention, on the database: a record added
// and last changed more than 12 months ago goes, in every scope (stores and
// the account), oldest first and a batch at a time; a younger one stays, and
// so does an old one changed since. A key whose record is gone runs again.
// Time passes by moving the rows' dates back, on the database's clock.

const STORE_A = "op_store_a_00000001";
const STORE_B = "op_store_b_00000001";
const USER = "op_user_00000000001";

const actor = (storeId: string): ScopedActor => ({
  storeId,
  transport: "mcp",
  isPlatformAdmin: false,
  credential: {
    kind: "oauth",
    id: "op_grant_0000000001",
    clientName: "Claude",
    userId: USER,
    email: null,
    storeId: null,
    stores: null,
    scopes: null,
    confirmSensitive: false,
    bundles: null,
  },
});

describe(
  "records of writes past their retention (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orm: typeof import("drizzle-orm");
    let operations: typeof import("./operations");

    before(async () => {
      database = await createTestDatabase("api_operations_retention");
      louezDb = await import("@louez/db");
      orm = await import("drizzle-orm");
      operations = await import("./operations");
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      await louezDb.db.delete(louezDb.apiOperations);
    });

    /** Records one write through `runOperation`, as a procedure does. */
    const write = async (storeId: string, idempotencyKey: string | null = null) => {
      const receipt: { operationId?: string } = {};
      let ran = 0;
      await operations.runOperation(
        {
          actor: actor(storeId),
          procedure: "dashboard.customers.update",
          input: { name: "Jeanne Dupont" },
          idempotencyKey,
          receipt,
          toStored: async (result) => result,
        },
        async () => {
          ran += 1;
          return { id: "op_customer_000001", name: "Jeanne Dupont" };
        },
      );
      return { id: String(receipt.operationId), ran };
    };

    /** Moves a record's dates back: added `createdMonths` ago, last changed `updatedMonths` ago. */
    const age = (id: string, createdMonths: number, updatedMonths = createdMonths) =>
      louezDb.db
        .update(louezDb.apiOperations)
        .set({
          createdAt: orm.sql`NOW() - INTERVAL ${createdMonths} MONTH`,
          updatedAt: orm.sql`NOW() - INTERVAL ${updatedMonths} MONTH`,
        })
        .where(orm.eq(louezDb.apiOperations.id, id));

    const remaining = async () =>
      (await louezDb.db.select({ id: louezDb.apiOperations.id }).from(louezDb.apiOperations))
        .map((row) => row.id)
        .sort();

    test("records older than 12 months go, in every scope; younger ones stay", async () => {
      const oldA = (await write(STORE_A)).id;
      const oldB = (await write(STORE_B)).id;
      const oldAccount = (await write("")).id;
      const younger = (await write(STORE_A)).id;
      const recent = (await write(STORE_B)).id;
      await age(oldA, 13);
      await age(oldB, 25);
      await age(oldAccount, 13);
      await age(younger, 11);

      assert.equal(await operations.purgeOperations(), 3);
      assert.deepEqual(await remaining(), [younger, recent].sort());
      assert.equal(await operations.purgeOperations(), 0, "nothing left to purge");
    });

    test("an old record changed since stays until 12 months after its change", async () => {
      const changed = (await write(STORE_A)).id;
      await age(changed, 14, 2);
      assert.equal(await operations.purgeOperations(), 0);
      assert.deepEqual(await remaining(), [changed]);
    });

    test("a batch at a time, oldest first, within the time budget; the next run goes on", async () => {
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const { id } = await write(STORE_A);
        await age(id, 20 - index);
        ids.push(id);
      }
      const kept = (await write(STORE_A)).id;

      // Batches of two, with no time left after the first.
      assert.equal(await operations.purgeOperations({ batch: 2, budgetMs: 0 }), 2);
      assert.deepEqual(await remaining(), [...ids.slice(2), kept].sort(), "the two oldest went");
      assert.equal(await operations.purgeOperations({ batch: 2 }), 3);
      assert.deepEqual(await remaining(), [kept]);
    });

    test("the scope with the oldest record goes first", async () => {
      const newerA = (await write(STORE_A)).id;
      const olderB = (await write(STORE_B)).id;
      await age(newerA, 13);
      await age(olderB, 30);

      // No time left after the first batch: it is the oldest backlog's.
      assert.equal(await operations.purgeOperations({ budgetMs: 0 }), 1);
      assert.deepEqual(await remaining(), [newerA]);
    });

    test("a key whose record is gone runs again", async () => {
      const first = await write(STORE_A, "op-key-1");
      assert.equal(first.ran, 1);
      const replay = await write(STORE_A, "op-key-1");
      assert.equal(replay.ran, 0, "replayed while its record stands");
      assert.equal(replay.id, first.id);

      await age(first.id, 13);
      assert.equal(await operations.purgeOperations(), 1);
      const again = await write(STORE_A, "op-key-1");
      assert.equal(again.ran, 1);
      assert.notEqual(again.id, first.id);
    });
  },
);
