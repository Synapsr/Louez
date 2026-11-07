import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnOpenTransaction,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { ApiEvent } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";

process.env.AUTH_SECRET ??= "product-units-test-secret";
process.env.NODE_ENV = "test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of ["@louez/types", "@louez/utils", "@louez/validations"]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@pu.test` } } : null;
        },
      },
    },
  },
});

// Units and downtimes through the products procedures, on the database: the
// dashboard's session and an agent's API key.

const OWNER = "pu_owner_user_000001";
const MEMBER = "pu_member_user_00001";
const STORE = "pu_store_a_000000001";
const OTHER_STORE = "pu_store_b_000000001";

const JUNE_1 = new Date("2030-06-01T09:00:00Z");
const JUNE_3 = new Date("2030-06-03T09:00:00Z");

describe("product units procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let router: typeof import("./products").dashboardProductsRouter;

  const events: ApiEvent[] = [];
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    storage: createMemoryStorage(),
    afterCommit: (event: ApiEvent) => {
      events.push(event);
    },
  };

  before(async () => {
    database = await createTestDatabase("api_product_units");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    ({ dashboardProductsRouter: router } = await import("./products"));

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@pu.test" },
      { id: MEMBER, email: "member@pu.test" },
    ]);
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: OWNER, name: "A store", slug: "pu-store-a" },
      { id: OTHER_STORE, userId: OWNER, name: "B store", slug: "pu-store-b" },
    ]);
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    events.length = 0;
    await louezDb.db.delete(louezDb.reservationItemUnits);
    await louezDb.db.delete(louezDb.reservationItems);
    await louezDb.db.delete(louezDb.reservations);
    await louezDb.db.delete(louezDb.productUnitDowntimes);
    await louezDb.db.delete(louezDb.productUnitEvents);
    await louezDb.db.delete(louezDb.productUnits);
    await louezDb.db.delete(louezDb.products);
  });

  // --- Callers --------------------------------------------------------------

  function session(userId = OWNER, store = STORE) {
    return {
      headers: new Headers({ [SESSION_HEADER]: userId, cookie: `louez_active_store=${store}` }),
      transport: "rpc" as const,
      ports,
      receipt: {},
    };
  }

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const readWrite: Permissions = {
    reservations: "read",
    products: "write",
    customers: "read",
    categories: "read",
    payments: "read",
    analytics: "read",
    settings: "read",
  };

  async function apiKey(options: { permissions?: Permissions; storeId?: string } = {}) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: options.storeId ?? STORE,
      userId: OWNER,
      name: "Units agent",
      permissions: options.permissions ?? readWrite,
    });
    return (extra: Record<string, string> = {}) => ({
      headers: new Headers({ authorization: `Bearer ${created.key}`, ...extra }),
      transport: "openapi" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    });
  }

  type Router = typeof router;
  type Client = RouterClient<Router>;

  function run<K extends keyof Router>(
    name: K,
    input: Parameters<Client[K]>[0],
    context: BaseContext,
  ): ReturnType<Client[K]> {
    const client = orpc.createRouterClient(router, {
      context,
      path: ["dashboard", "products"],
    }) as Client;
    const call = client[name] as (input: Parameters<Client[K]>[0]) => ReturnType<Client[K]>;
    return call(input);
  }

  async function rejects(promise: Promise<unknown>, code: string) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `expected ${code}, the call succeeded`);
    const { data, code: httpCode } = caught as { code?: string; data?: { code?: string } };
    assert.equal(data?.code ?? httpCode, code, String(caught));
    return caught as { data: { code: string; details?: Record<string, unknown> } };
  }

  const tokenOf = (refusal: { data: { details?: Record<string, unknown> } }) =>
    (refusal.data.details as { confirmationToken: string }).confirmationToken;
  const previewOf = (refusal: { data: { details?: Record<string, unknown> } }) =>
    (
      refusal.data.details as {
        preview: { summary: string; details: { reservations?: Array<{ number: string }> } };
      }
    ).preview;

  /** A product with two tracked units, as the dashboard creates it. */
  async function trackedProduct(storeId = STORE) {
    const created = await run(
      "create",
      {
        name: "Kayak",
        price: "40",
        trackUnits: true,
        units: [{ identifier: "K-1" }, { identifier: "K-2" }],
      },
      session(OWNER, storeId),
    );
    const [first, second] = [...created.units].sort((a, b) =>
      a.identifier.localeCompare(b.identifier),
    );
    return { product: created, first: first.id, second: second.id };
  }

  let bookingCount = 0;
  /** A confirmed booking holding `unitId`, written as checkout writes it. */
  function bookingRows(productId: string, unitId: string, window = { start: JUNE_1, end: JUNE_3 }) {
    bookingCount += 1;
    const suffix = String(bookingCount).padStart(4, "0");
    const reservationId = `pu_reservation_${suffix}`;
    const itemId = `pu_item_000000_${suffix}`;
    return {
      reservationId,
      itemId,
      number: `PU-${suffix}`,
      reservation: {
        id: reservationId,
        storeId: STORE,
        customerId: "customer",
        number: `PU-${suffix}`,
        status: "confirmed" as const,
        startDate: window.start,
        endDate: window.end,
        subtotalAmount: "80.00",
        depositAmount: "0.00",
        totalAmount: "80.00",
      },
      item: {
        id: itemId,
        reservationId,
        productId,
        quantity: 1,
        unitPrice: "40.00",
        depositPerUnit: "0.00",
        totalPrice: "80.00",
        combinationKey: "__default",
        productSnapshot: { name: "Kayak", description: null, images: [] },
      },
      assignment: { reservationItemId: itemId, productUnitId: unitId, identifierSnapshot: "K" },
    };
  }

  async function book(productId: string, unitId: string, window?: { start: Date; end: Date }) {
    const rows = bookingRows(productId, unitId, window);
    await louezDb.db.insert(louezDb.reservations).values(rows.reservation);
    await louezDb.db.insert(louezDb.reservationItems).values(rows.item);
    await louezDb.db.insert(louezDb.reservationItemUnits).values(rows.assignment);
    return rows;
  }

  const eventTypes = async (unitId: string) =>
    (
      await louezDb.db
        .select({ type: louezDb.productUnitEvents.type })
        .from(louezDb.productUnitEvents)
        .where(orm.eq(louezDb.productUnitEvents.productUnitId, unitId))
    )
      .map((row) => row.type)
      .sort();

  // --- Downtimes ------------------------------------------------------------

  test("a session declares a downtime over a booking: done at once, the booking named with a replacement", async () => {
    const { product, first, second } = await trackedProduct();
    const booking = await book(product.id, first);
    events.length = 0;

    const declared = await run(
      "declareDowntime",
      { unitId: first, reason: "repair", startsAt: JUNE_1, endsAt: JUNE_3, note: "  Leak  " },
      session(),
    );
    assert.equal(declared.conflicts.length, 1);
    const [conflict] = declared.conflicts;
    assert.equal(conflict.reservationNumber, booking.number);
    assert.deepEqual(
      conflict.replacementCandidates.map((candidate) => candidate.id),
      [second],
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["product.units.changed"],
    );

    const history = await run("getUnitHistory", { unitId: first }, session(MEMBER));
    assert.equal(history.downtimes.length, 1);
    assert.equal(history.downtimes[0].note, "Leak");
    assert.ok((await eventTypes(first)).includes("downtime_declared"));
  });

  test("an agent's downtime over a booking asks first; a booking made since voids the token", async () => {
    const { product, first } = await trackedProduct();
    const context = await apiKey();

    // No booking in the window: it runs without asking.
    const free = await run(
      "declareDowntime",
      {
        unitId: first,
        reason: "maintenance",
        startsAt: new Date("2031-01-01T00:00:00Z"),
        endsAt: new Date("2031-01-02T00:00:00Z"),
      },
      context(),
    );
    assert.deepEqual(free.conflicts, []);

    const booking = await book(product.id, first);
    const input = { unitId: first, reason: "repair" as const, startsAt: JUNE_1, endsAt: null };
    const asked = await rejects(run("declareDowntime", input, context()), "CONFIRMATION_REQUIRED");
    assert.deepEqual(
      previewOf(asked).details.reservations?.map((reservation) => reservation.number),
      [booking.number],
    );
    assert.match(previewOf(asked).summary, /1 reservation\(s\) hold it then/);

    // Another booking lands before the confirmation: the preview no longer holds.
    await book(product.id, first, {
      start: new Date("2030-07-01T09:00:00Z"),
      end: new Date("2030-07-02T09:00:00Z"),
    });
    await rejects(
      run("declareDowntime", input, context({ "louez-confirmation": tokenOf(asked) })),
      "CONFIRMATION_INVALID",
    );
    const again = await rejects(run("declareDowntime", input, context()), "CONFIRMATION_REQUIRED");
    assert.equal(previewOf(again).details.reservations?.length, 2);
    const done = await run(
      "declareDowntime",
      input,
      context({ "louez-confirmation": tokenOf(again) }),
    );
    assert.equal(done.conflicts.length, 2);
  });

  test("a downtime is changed in part, closed, and deleted; deleting asks an agent and needs the delete right", async () => {
    const { first } = await trackedProduct();
    const { downtimeId } = await run(
      "declareDowntime",
      { unitId: first, reason: "maintenance", startsAt: JUNE_1, note: "Check" },
      session(),
    );

    await run("updateDowntime", { downtimeId, reason: "repair" }, session(MEMBER));
    let [downtime] = (await run("getUnitHistory", { unitId: first }, session())).downtimes;
    assert.equal(downtime.reason, "repair");
    assert.equal(downtime.note, "Check", "a field left out is unchanged");
    assert.equal(downtime.endsAt, null);

    await rejects(
      run("updateDowntime", { downtimeId, endsAt: new Date("2030-05-01T00:00:00Z") }, session()),
      "DOWNTIME_DATES_INVALID",
    );
    const closed = await run("closeDowntime", { downtimeId, endsAt: JUNE_3 }, session(MEMBER));
    assert.equal(closed.endsAt.toISOString(), JUNE_3.toISOString());
    [downtime] = (await run("getUnitHistory", { unitId: first }, session())).downtimes;
    assert.equal(downtime.endsAt, JUNE_3.toISOString());

    await rejects(run("deleteDowntime", { downtimeId }, session(MEMBER)), "PERMISSION_DENIED");
    const context = await apiKey();
    const asked = await rejects(
      run("deleteDowntime", { downtimeId }, context()),
      "CONFIRMATION_REQUIRED",
    );
    assert.match(previewOf(asked).summary, /Delete the repair downtime of the unit "K-1"/);
    await run("deleteDowntime", { downtimeId }, context({ "louez-confirmation": tokenOf(asked) }));
    assert.deepEqual((await run("getUnitHistory", { unitId: first }, session())).downtimes, []);
    assert.deepEqual(await eventTypes(first), [
      "created",
      "downtime_closed",
      "downtime_declared",
      "downtime_deleted",
      "downtime_updated",
    ]);
  });

  // --- Retirement -----------------------------------------------------------

  test("retiring asks an agent every time; reinstating puts the unit back; each is refused twice", async () => {
    const { product, first } = await trackedProduct();
    const context = await apiKey();
    const input = { unitId: first, reason: "broken" as const, note: "Hull cracked" };

    const asked = await rejects(run("retireUnit", input, context()), "CONFIRMATION_REQUIRED");
    assert.match(previewOf(asked).summary, /Retire the unit "K-1" of "Kayak"/);
    const retired = await run(
      "retireUnit",
      input,
      context({ "louez-confirmation": tokenOf(asked) }),
    );
    assert.deepEqual(retired, { unitId: first, conflicts: [] });
    await rejects(run("retireUnit", input, session()), "UNIT_ALREADY_RETIRED");

    const stored = await run("get", { id: product.id }, session());
    assert.equal(stored.units.find((unit) => unit.id === first)?.lifecycleStatus, "retired");

    assert.deepEqual(await run("reinstateUnit", { unitId: first }, context()), { unitId: first });
    await rejects(run("reinstateUnit", { unitId: first }, context()), "UNIT_NOT_RETIRED");
    assert.deepEqual(await eventTypes(first), ["created", "reinstated", "retired"]);
  });

  test("a session retires a booked unit at once and gets the bookings to move", async () => {
    const { product, first, second } = await trackedProduct();
    const booking = await book(product.id, first);
    const retired = await run("retireUnit", { unitId: first, reason: "lost" }, session(MEMBER));
    assert.deepEqual(
      retired.conflicts.map((conflict) => conflict.reservationNumber),
      [booking.number],
    );
    assert.deepEqual(
      retired.conflicts[0].replacementCandidates.map((candidate) => candidate.id),
      [second],
    );
  });

  // --- Details --------------------------------------------------------------

  test("unit details change in part, null clears, and an unchanged save records nothing", async () => {
    const { first } = await trackedProduct();
    const updated = await run(
      "updateUnitDetails",
      { unitId: first, notes: " Blue ", purchasePrice: "450,5", purchasedAt: JUNE_1 },
      session(),
    );
    assert.deepEqual(updated, {
      unitId: first,
      notes: "Blue",
      purchasePrice: "450.50",
      purchasedAt: JUNE_1,
    });
    const cleared = await run(
      "updateUnitDetails",
      { unitId: first, purchasePrice: null },
      session(),
    );
    assert.equal(cleared.purchasePrice, null);
    assert.equal(cleared.notes, "Blue", "a field left out is unchanged");

    const before = (await eventTypes(first)).length;
    events.length = 0;
    await run("updateUnitDetails", { unitId: first, notes: "Blue" }, session());
    assert.equal((await eventTypes(first)).length, before);
    assert.deepEqual(events, []);
  });

  // --- Isolation and rights -------------------------------------------------

  test("another store's units and downtimes are not found; a read-only key reads only", async () => {
    const theirs = await trackedProduct(OTHER_STORE);
    const { downtimeId } = await run(
      "declareDowntime",
      { unitId: theirs.first, reason: "repair", startsAt: JUNE_1 },
      session(OWNER, OTHER_STORE),
    );
    const mine = await apiKey();
    await rejects(run("getUnitHistory", { unitId: theirs.first }, mine()), "UNIT_NOT_FOUND");
    await rejects(
      run("declareDowntime", { unitId: theirs.first, reason: "repair", startsAt: JUNE_1 }, mine()),
      "UNIT_NOT_FOUND",
    );
    await rejects(run("closeDowntime", { downtimeId }, mine()), "DOWNTIME_NOT_FOUND");
    await rejects(run("deleteDowntime", { downtimeId }, mine()), "DOWNTIME_NOT_FOUND");
    await rejects(run("updateDowntime", { downtimeId, note: "x" }, mine()), "DOWNTIME_NOT_FOUND");
    await rejects(
      run("retireUnit", { unitId: theirs.first, reason: "sold" }, mine()),
      "UNIT_NOT_FOUND",
    );
    await rejects(run("reinstateUnit", { unitId: theirs.first }, mine()), "UNIT_NOT_FOUND");
    await rejects(
      run("updateUnitDetails", { unitId: theirs.first, notes: "x" }, mine()),
      "UNIT_NOT_FOUND",
    );

    const { first } = await trackedProduct();
    const readOnly = await apiKey({ permissions: { ...readWrite, products: "read" } });
    assert.deepEqual((await run("getUnitHistory", { unitId: first }, readOnly())).downtimes, []);
    await rejects(
      run("declareDowntime", { unitId: first, reason: "repair", startsAt: JUNE_1 }, readOnly()),
      "PERMISSION_DENIED",
    );
    await rejects(
      run("retireUnit", { unitId: first, reason: "sold" }, readOnly()),
      "PERMISSION_DENIED",
    );
  });

  // --- Races ----------------------------------------------------------------

  /** What checkout does while the call waits: the product's row first, then the booking. */
  async function raceAgainstCheckout<T>(productId: string, unitId: string, call: () => Promise<T>) {
    const { drizzle } = await import("drizzle-orm/mysql2");
    const rows = bookingRows(productId, unitId);
    const [answer] = await raceOnOpenTransaction(
      database,
      async (holder) => {
        await holder.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [productId]);
        const checkout = drizzle(holder);
        await checkout.insert(louezDb.reservations).values(rows.reservation);
        await checkout.insert(louezDb.reservationItems).values(rows.item);
        await checkout.insert(louezDb.reservationItemUnits).values(rows.assignment);
      },
      [call],
    );
    return { answer, booking: rows };
  }

  test("a downtime waits for a checkout holding the product, then names its booking", async () => {
    const { product, first } = await trackedProduct();
    const { answer, booking } = await raceAgainstCheckout(product.id, first, () =>
      run(
        "declareDowntime",
        { unitId: first, reason: "repair", startsAt: JUNE_1, endsAt: JUNE_3 },
        session(),
      ),
    );
    assert.deepEqual(
      answer.conflicts.map((conflict) => conflict.reservationNumber),
      [booking.number],
    );
  });

  test("an agent's retirement waits for a checkout holding the product, then asks about its booking", async () => {
    const { product, first } = await trackedProduct();
    const context = await apiKey();
    const { answer, booking } = await raceAgainstCheckout(product.id, first, () =>
      run("retireUnit", { unitId: first, reason: "broken" }, context()).then(
        () => null,
        (error: { data?: { code?: string; details?: Record<string, unknown> } }) => error,
      ),
    );
    assert.equal(answer?.data?.code, "CONFIRMATION_REQUIRED");
    assert.deepEqual(
      previewOf(
        answer as { data: { details?: Record<string, unknown> } },
      ).details.reservations?.map((reservation) => reservation.number),
      [booking.number],
    );
    const [unit] = await louezDb.db
      .select({ lifecycleStatus: louezDb.productUnits.lifecycleStatus })
      .from(louezDb.productUnits)
      .where(orm.eq(louezDb.productUnits.id, first));
    assert.equal(unit.lifecycleStatus, "active", "nothing was done before the confirmation");
  });
});
