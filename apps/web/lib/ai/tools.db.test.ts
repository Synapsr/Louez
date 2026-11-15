import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { createTestUrls } from "@louez/api/platform/test-urls";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { createAITools } from "./tools";

// The assistant's tools on a migrated database.

// The status-change module the tools import pulls in "server-only".
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    return next(specifier, context);
  },
});

const STORE = "store_ai_tools";
const USER = "user_ai_tools";
const SETTINGS = {
  reservationMode: "payment",
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 0,
  turnoverBufferMinutes: 0,
  currency: "EUR",
} as const;

type Tools = ReturnType<typeof createAITools>;

describe("assistant tools (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("ai_tools");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "owner@ai.test" });
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: USER,
      name: "AI tools",
      slug: "ai-tools",
      settings: SETTINGS,
    });
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: USER, role: "owner" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  /** 100.00 tax included, 10.00 of it insurance. */
  async function createReservation(): Promise<string> {
    const id = `res_ai_${++counter}`;
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer",
      number: id,
      status: "confirmed",
      startDate: new Date("2027-03-01T09:00:00Z"),
      endDate: new Date("2027-03-03T09:00:00Z"),
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
      tulipInsuranceAmount: "10.00",
      currency: "USD",
    });
    await louezDb.db.insert(louezDb.reservationItems).values([
      {
        reservationId: id,
        productId: null,
        quantity: 1,
        unitPrice: "90.00",
        depositPerUnit: "0.00",
        totalPrice: "90.00",
        taxRate: "20.00",
        productSnapshot: { name: "Bike", description: null, images: [] },
      },
      {
        reservationId: id,
        productId: null,
        quantity: 1,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "10.00",
        productSnapshot: { name: "Insurance", description: null, images: [] },
      },
    ]);
    return id;
  }

  const options = { toolCallId: "call", messages: [] };

  test("a customer's reservation history, ids and links show only to a user who may read reservations", async () => {
    // A reservation of the customer, for its history.
    const reservationId = await createReservation();
    await louezDb.db
      .insert(louezDb.customers)
      .values({
        id: "customer",
        storeId: STORE,
        email: "linked@ai.test",
        firstName: "Lea",
        lastName: "Link",
      })
      .onDuplicateKeyUpdate({ set: { firstName: "Lea" } });
    const aiTools = await import("./tools");
    const toolsWith = (permissions: Partial<Record<string, "none" | "read" | "write">>) =>
      aiTools.createAITools({
        storeId: STORE,
        userId: USER,
        storeName: "AI tools",
        urls: createTestUrls(),
        permissions: {
          reservations: "read",
          products: "read",
          customers: "read",
          categories: "read",
          payments: "read",
          analytics: "read",
          settings: "read",
          ...permissions,
        },
      });
    const customerOf = async (scoped: Tools) => {
      const output = await scoped.get_customer.execute?.({ customerId: "customer" }, options);
      assert.ok(output && "customer" in output, JSON.stringify(output));
      return JSON.stringify(output);
    };

    const blind = await customerOf(toolsWith({ reservations: "none" }));
    assert.ok(blind.includes(`/dashboard/customers/customer?store=${STORE}`), blind);
    assert.ok(!blind.includes(reservationId), blind);
    assert.ok(!blind.includes("/dashboard/reservations/"), blind);
    // Only the fields the tool picks: nothing of the store's row.
    assert.ok(!blind.includes('"storeId"'), blind);

    const seeing = await customerOf(toolsWith({}));
    assert.ok(seeing.includes(`/dashboard/reservations/${reservationId}?store=${STORE}`), seeing);
  });
});
