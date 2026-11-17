import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// `stripe_connect_completed` is queued once per store: by the first write that
// finds charges enabled, whether the webhook or a status sync makes it, and
// never again — not on a redelivered event, nor after the account is disabled
// and enabled again. A store chargeable before the column never counts it.

const STORE = "sc_store_00000000001";
const OWNER = "sc_owner";

describe("Stripe Connect completion (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let connect: typeof import("./stripe-connect");

  before(async () => {
    database = await createTestDatabase("stripe_connect");
    louezDb = await import("@louez/db");
    connect = await import("./stripe-connect");
    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "sc@sc.test" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.apiEffects);
    await louezDb.db.delete(louezDb.stores);
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: OWNER,
      name: "Store",
      slug: "sc-store",
      stripeAccountId: "acct_1",
    });
  });

  const lifecycleRows = async () =>
    (await louezDb.db.select().from(louezDb.apiEffects)).filter(
      (row) => row.type === "store.lifecycleAnalytics",
    );

  test("the first write with charges enabled queues it once, on the owner", async () => {
    // Onboarding not done yet: nothing.
    assert.deepEqual(await connect.writeConnectColumns(STORE, { stripeChargesEnabled: false }), []);
    const ids = await connect.writeConnectColumns(STORE, {
      stripeChargesEnabled: true,
      stripeOnboardingComplete: true,
    });
    assert.equal(ids.length, 1);
    // The same event again (a redelivery, a sync after the webhook).
    assert.deepEqual(
      await connect.writeConnectColumns(STORE, {
        stripeChargesEnabled: true,
        stripeOnboardingComplete: true,
      }),
      [],
    );

    const rows = await lifecycleRows();
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row?.id, ids[0]);
    assert.equal(row?.storeId, STORE);
    const payload = row?.payload as Record<string, unknown>;
    assert.equal(payload.event, "stripe_connect_completed");
    assert.equal(payload.ownerUserId, OWNER);
    assert.equal(typeof payload.eventUuid, "string");
    assert.equal(Reflect.get(Object(payload.properties), "details_submitted"), true);

    const store = await louezDb.db.query.stores.findFirst({ where: eq(louezDb.stores.id, STORE) });
    assert.ok(store?.stripeConnectCompletedAt instanceof Date);
  });

  test("an account disabled, then enabled again, does not count it twice", async () => {
    await connect.writeConnectColumns(STORE, { stripeChargesEnabled: true });
    await connect.writeConnectColumns(STORE, { stripeChargesEnabled: false });
    await connect.writeConnectColumns(STORE, { stripeAccountId: "acct_2" });
    assert.deepEqual(await connect.writeConnectColumns(STORE, { stripeChargesEnabled: true }), []);
    assert.equal((await lifecycleRows()).length, 1);
  });

  test("two writes at once queue one event", async () => {
    const results = await Promise.all([
      connect.writeConnectColumns(STORE, { stripeChargesEnabled: true }),
      connect.writeConnectColumns(STORE, { stripeChargesEnabled: true }),
    ]);
    assert.equal(results.flat().length, 1);
    assert.equal((await lifecycleRows()).length, 1);
  });

  test("a store marked before (the migration's backfill) never counts it", async () => {
    await louezDb.db
      .update(louezDb.stores)
      .set({ stripeChargesEnabled: true, stripeConnectCompletedAt: new Date("2026-01-01") })
      .where(eq(louezDb.stores.id, STORE));
    assert.deepEqual(await connect.writeConnectColumns(STORE, { stripeChargesEnabled: true }), []);
    assert.equal((await lifecycleRows()).length, 0);
  });
});
