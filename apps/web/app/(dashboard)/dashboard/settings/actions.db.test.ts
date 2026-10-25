import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The settings actions on a migrated database: a write of a field in the store's
// billing snapshot marks the store in its transaction (louez-billing docs/api,
// README §5.2); the other settings writers keep those fields and mark nothing.

const STORE = "store_settings_marks";
const SETTINGS = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 0,
  turnoverBufferMinutes: 0,
  currency: "EUR",
  country: "FR",
  timezone: "Europe/Paris",
} as const;

// The session, Next.js and Discord are stubbed; the database is real.
const stubs = {
  "@/lib/store-context": {
    getCurrentStore: async () => ({
      id: STORE,
      name: "Settings marks",
      slug: "settings-marks",
      role: "owner",
      settings: SETTINGS,
    }),
    hasPermission: () => true,
  },
  "next/cache": { revalidatePath: () => undefined },
  "@/lib/discord/platform-notifications": { notifyStoreSettingsUpdated: async () => undefined },
};
Reflect.set(globalThis, "__louezSettingsActionStubs", stubs);
const directory = mkdtempSync(join(tmpdir(), "louez-settings-actions-"));
after(() => rmSync(directory, { recursive: true }));
const fixtures = new Map(
  Object.keys(stubs).map((specifier, index) => {
    const path = join(directory, `stub-${index}.cjs`);
    writeFileSync(
      path,
      `module.exports = globalThis.__louezSettingsActionStubs[${JSON.stringify(specifier)}];`,
    );
    return [specifier, pathToFileURL(path).href];
  }),
);
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    const url = fixtures.get(specifier);
    return url ? { url, shortCircuit: true } : next(specifier, context);
  },
});

process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

describe("settings actions billing marks (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");

  before(async () => {
    database = await createTestDatabase("settings_marks");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    actions = await import("./actions");
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Settings marks",
      slug: "settings-marks",
      settings: SETTINGS,
    });
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

  test("a currency change saves the settings and marks the store", async () => {
    assert.deepEqual(
      await actions.updateCompanySettings({
        country: "US",
        currency: "USD",
        billingAddressSameAsStore: true,
      }),
      { success: true },
    );

    const store = await louezDb.db.query.stores.findFirst({
      where: (table) => eq(table.id, STORE),
      columns: { settings: true },
    });
    assert.equal(store?.settings?.currency, "USD");
    assert.deepEqual(await storeMarks(), [{ id: STORE, version: 1 }]);
  });

  test("a slug change marks the store", async () => {
    assert.deepEqual(await actions.updateStoreSlug("settings-marks-renamed"), {
      success: true,
      newSlug: "settings-marks-renamed",
    });
    assert.deepEqual(await storeMarks(), [{ id: STORE, version: 1 }]);
  });

  test("the reservation rules keep the snapshot's settings and mark nothing", async () => {
    assert.deepEqual(
      await actions.updateReservationRules({
        reservationMode: "request",
        pendingBlocksAvailability: true,
        automaticExtensions: false,
        maxExtensionDays: null,
        onlinePaymentDepositPercentage: 100,
        minRentalMinutes: 60,
        maxRentalMinutes: null,
        advanceNoticeMinutes: 0,
        turnoverBufferMinutes: 0,
        requireCustomerAddress: false,
      }),
      { success: true },
    );
    assert.deepEqual(await storeMarks(), []);
  });
});
