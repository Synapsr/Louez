import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";
import type { TaxSettings } from "@louez/types";

// The tax settings action on a migrated database. In a store that prices
// excluding tax, a reservation with an untaxed item has a billing snapshot total
// that gets the store's default rate (louez-billing docs/api, Q6), so a change of
// that rate marks those reservations in the write's transaction.

const STORE = "store_tax_marks";
const OTHER_STORE = "store_tax_marks_other";
const SETTINGS = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 0,
  turnoverBufferMinutes: 0,
  currency: "EUR",
} as const;
const EXCLUSIVE_20: TaxSettings = { enabled: true, defaultRate: 20, displayMode: "exclusive" };

// The session and Next.js are stubbed; the database is real.
const stubs = {
  "@/lib/store-context": {
    getCurrentStore: async () => ({
      id: STORE,
      name: "Tax marks",
      slug: "tax-marks",
      role: "owner",
      settings: SETTINGS,
    }),
    hasPermission: () => true,
  },
  "next/cache": { revalidatePath: () => undefined },
};
Reflect.set(globalThis, "__louezTaxActionStubs", stubs);
const directory = mkdtempSync(join(tmpdir(), "louez-tax-actions-"));
after(() => rmSync(directory, { recursive: true }));
const fixtures = new Map(
  Object.keys(stubs).map((specifier, index) => {
    const path = join(directory, `stub-${index}.cjs`);
    writeFileSync(
      path,
      `module.exports = globalThis.__louezTaxActionStubs[${JSON.stringify(specifier)}];`,
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

describe("tax settings billing marks (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");

  before(async () => {
    database = await createTestDatabase("tax_marks");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    actions = await import("./actions");
    const { db, reservationItems, reservations, stores } = louezDb;
    await db.insert(stores).values([
      { id: STORE, userId: "owner", name: "Tax marks", slug: "tax-marks", settings: SETTINGS },
      {
        id: OTHER_STORE,
        userId: "owner",
        name: "Other",
        slug: "tax-marks-other",
        settings: { ...SETTINGS, tax: EXCLUSIVE_20 },
      },
    ]);
    // A dashboard reservation (untaxed item), a storefront one (taxed item), and
    // a dashboard reservation of another store.
    const seeded = [
      { id: "res_untaxed", storeId: STORE, taxRate: null },
      { id: "res_taxed", storeId: STORE, taxRate: "20.00" },
      { id: "res_elsewhere", storeId: OTHER_STORE, taxRate: null },
    ];
    await db.insert(reservations).values(
      seeded.map(({ id, storeId }, index) => ({
        id,
        storeId,
        customerId: "customer",
        number: `R-${index + 1}`,
        status: "completed" as const,
        startDate: new Date("2026-06-01T09:00:00Z"),
        endDate: new Date("2026-06-02T09:00:00Z"),
        subtotalAmount: "100.00",
        depositAmount: "0.00",
        totalAmount: "100.00",
      })),
    );
    await db.insert(reservationItems).values(
      seeded.map(({ id, taxRate }) => ({
        id: `item_${id}`,
        reservationId: id,
        productId: "product",
        quantity: 1,
        unitPrice: "100.00",
        depositPerUnit: "0.00",
        totalPrice: "100.00",
        taxRate,
        productSnapshot: { name: "Kayak", description: null, images: [] },
      })),
    );
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    const { billingSyncQueue, db, stores } = louezDb;
    await db
      .update(stores)
      .set({ settings: { ...SETTINGS, tax: EXCLUSIVE_20 } })
      .where(eq(stores.id, STORE));
    await db.delete(billingSyncQueue);
  });

  async function marks() {
    const { billingSyncQueue: queue, db } = louezDb;
    const rows = await db
      .select({ type: queue.aggregateType, id: queue.aggregateId, storeId: queue.storeId })
      .from(queue);
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }

  async function storedTax() {
    const store = await louezDb.db.query.stores.findFirst({
      where: (table) => eq(table.id, STORE),
      columns: { settings: true },
    });
    return store?.settings?.tax;
  }

  test("a rate change marks every reservation of the store, and only of that store", async () => {
    assert.deepEqual(await actions.updateTaxSettings({ ...EXCLUSIVE_20, defaultRate: 10 }), {
      success: true,
    });
    assert.equal((await storedTax())?.defaultRate, 10);
    assert.deepEqual(await marks(), [
      { type: "reservation", id: "res_taxed", storeId: STORE },
      { type: "reservation", id: "res_untaxed", storeId: STORE },
    ]);
  });

  test("a switch to prices including tax marks them too", async () => {
    await actions.updateTaxSettings({ ...EXCLUSIVE_20, displayMode: "inclusive" });
    assert.deepEqual(await marks(), [
      { type: "reservation", id: "res_taxed", storeId: STORE },
      { type: "reservation", id: "res_untaxed", storeId: STORE },
    ]);
  });

  test("a label or tax number change keeps the totals and marks nothing", async () => {
    assert.deepEqual(
      await actions.updateTaxSettings({ ...EXCLUSIVE_20, taxLabel: "VAT", taxNumber: "FR123" }),
      { success: true },
    );
    assert.equal((await storedTax())?.taxLabel, "VAT");
    assert.deepEqual(await marks(), []);
  });

  test("a rate change in a store that prices including tax marks nothing", async () => {
    const inclusive: TaxSettings = { ...EXCLUSIVE_20, displayMode: "inclusive" };
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings: { ...SETTINGS, tax: inclusive } })
      .where(eq(louezDb.stores.id, STORE));
    await actions.updateTaxSettings({ ...inclusive, defaultRate: 5.5 });
    assert.deepEqual(await marks(), []);
  });

  test("with the billing service off, the settings are saved and nothing is marked", async () => {
    process.env.LOUEZ_BILLING = "off";
    try {
      await actions.updateTaxSettings({ ...EXCLUSIVE_20, defaultRate: 10 });
    } finally {
      process.env.LOUEZ_BILLING = "cloud";
    }
    assert.equal((await storedTax())?.defaultRate, 10);
    assert.deepEqual(await marks(), []);
  });
});
