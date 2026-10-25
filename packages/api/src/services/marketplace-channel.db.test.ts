import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The marketplace channel status, publication and cohort are in the store's billing
// snapshot: enabling and disabling mark the store in their transaction
// (louez-billing docs/api, README §5.2).

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

const STORE = "store_channel_marks";

describe(
  "marketplace channel billing marks (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let channel: typeof import("./marketplace-channel");

    before(async () => {
      database = await createTestDatabase("channel_marks");
      // DATABASE_URL now points at the test database.
      louezDb = await import("@louez/db");
      channel = await import("./marketplace-channel");
      await louezDb.db
        .insert(louezDb.stores)
        .values({ id: STORE, userId: "owner", name: "Channel marks", slug: "channel-marks" });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      await louezDb.db.delete(louezDb.billingSyncQueue);
    });

    async function storeMarks() {
      const { billingSyncQueue: queueTable } = louezDb;
      return louezDb.db
        .select({ id: queueTable.aggregateId, version: queueTable.version })
        .from(queueTable)
        .where(eq(queueTable.aggregateType, "store"));
    }

    test("enabling the channel marks the store", async () => {
      const state = await channel.enableMarketplaceChannel({
        storeId: STORE,
        source: "owner",
        connectedByUserId: "owner",
        input: { acceptTerms: true },
      });

      assert.equal(state.channel?.status, "setup_required");
      assert.deepEqual(await storeMarks(), [{ id: STORE, version: 1 }]);
    });

    test("disabling the channel marks the store", async () => {
      const state = await channel.disableMarketplaceChannel({ storeId: STORE });

      assert.equal(state.channel?.status, "disabled");
      assert.deepEqual(await storeMarks(), [{ id: STORE, version: 1 }]);
    });
  },
);
