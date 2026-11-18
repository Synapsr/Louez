import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, mock, test } from "node:test";

import { createTestAccessTokens } from "@louez/auth/testing";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../context";

import { createMemoryStorage } from "../platform/memory-storage";
import { createTestNewStores } from "../platform/test-new-stores";
import { createTestUrls } from "../platform/test-urls";

process.env.AUTH_SECRET ??= "test-reservation-readers-secret";
process.env.NODE_ENV = "test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A dashboard session read from a test header, and OAuth tokens signed by a
// test key: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
const ISSUER = "https://app.louez.test/api/auth";
const RESOURCE = "https://app.louez.test/api/mcp";
let tokens: Awaited<ReturnType<typeof createTestAccessTokens>>;
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    verifyMcpAccessToken: (token: string) => tokens.verify(token),
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@tr.test` } } : null;
        },
      },
    },
  },
});

// The readers a test reservation must stay out of, on a migrated database
// (docs/domain/reservation-invariants.md, TR1 to TR4): a store with a real
// booking and a test reservation of the same unit over the same dates. The
// test one holds no unit, counts in no figure and no milestone, is never
// billed and takes no consumable; a person in the dashboard sees it, and an
// API key, an OAuth connection and the in-app assistant read it as missing.

const OWNER = "tr_owner_user_000001";
const CLIENT = "https://agent.tr.test/oauth/client.json";
const START = new Date("2031-06-10T09:00:00.000Z");
const END = new Date("2031-06-12T09:00:00.000Z");
const BILLING_ENV = ["LOUEZ_BILLING", "BILLING_SERVICE_URL", "BILLING_NEW_STORES_FROM"] as const;

describe(
  "test reservations stay out of the readers (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orpc: typeof import("@orpc/server");
    let orm: typeof import("drizzle-orm");
    let apiKeys: typeof import("./api-keys");
    let grants: typeof import("./agent-grants");
    let unitConflicts: typeof import("./unit-conflicts");
    let storeMetrics: typeof import("./store-metrics");
    let analytics: typeof import("./analytics");
    let sales: typeof import("./sales-analytics");
    let launch: typeof import("./launch");
    let unitHistory: typeof import("./product-unit-history");
    let router: typeof import("../routers/dashboard/reservations").dashboardReservationsRouter;

    const ports = {
      planFeatures: async () => ({ apiAccess: true }),
      storage: createMemoryStorage(),
      urls: createTestUrls(),
      afterCommit: () => {},
      runReservationEffects: async () => {},
      insurance: { createContract: async () => null, cancelContract: async () => {} },
      newStores: createTestNewStores(),
      dispatchEffects: () => {},
      emailConfigured: () => true,
      smsConfigured: () => true,
    };

    const settings = {
      reservationMode: "request" as const,
      currency: "EUR",
      timezone: "UTC",
      pendingBlocksAvailability: false,
      advanceNoticeMinutes: 0,
      minRentalMinutes: 0,
      turnoverBufferMinutes: 0,
    };

    before(async () => {
      tokens = await createTestAccessTokens({ issuer: ISSUER, audience: RESOURCE });
      database = await createTestDatabase("api_test_reservation_readers");
      louezDb = await import("@louez/db");
      orpc = await import("@orpc/server");
      orm = await import("drizzle-orm");
      apiKeys = await import("./api-keys");
      grants = await import("./agent-grants");
      unitConflicts = await import("./unit-conflicts");
      storeMetrics = await import("./store-metrics");
      analytics = await import("./analytics");
      sales = await import("./sales-analytics");
      launch = await import("./launch");
      unitHistory = await import("./product-unit-history");
      ({ dashboardReservationsRouter: router } = await import("../routers/dashboard/reservations"));

      await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@tr.test" });
      await louezDb.db.insert(louezDb.oauthClients).values({
        clientId: CLIENT,
        name: "Agent",
        uri: "https://agent.tr.test",
        clientDiscoveryId: "cimd",
        redirectUris: JSON.stringify(["https://agent.tr.test/callback"]),
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    // --- Fixtures -------------------------------------------------------------

    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(10, "0")}`;

    /**
     * A store with a tracked product of two units and a consumable, a real
     * booking and a test reservation holding the same unit over the same dates.
     */
    async function seed(
      options: {
        realStatus?: "pending" | "confirmed";
        testStatus?: "pending" | "confirmed";
        withReal?: boolean;
      } = {},
    ) {
      const storeId = nextId("tr_store");
      await louezDb.db
        .insert(louezDb.stores)
        .values({
          id: storeId,
          userId: OWNER,
          name: "Shop",
          slug: storeId.replaceAll("_", "-"),
          settings,
        });
      await louezDb.db
        .insert(louezDb.storeMembers)
        .values({ storeId, userId: OWNER, role: "owner" });

      const productId = nextId("tr_prd");
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId,
        name: "Kayak",
        price: "10.00",
        pricingMode: "day",
        status: "active",
        trackUnits: true,
        quantity: 2,
      });
      const unitIds = [nextId("tr_unt"), nextId("tr_unt")];
      await louezDb.db
        .insert(louezDb.productUnits)
        .values(unitIds.map((id, index) => ({ id, productId, identifier: `K${index + 1}` })));
      const consumableId = nextId("tr_prd");
      await louezDb.db.insert(louezDb.products).values({
        id: consumableId,
        storeId,
        name: "Sunscreen",
        price: "5.00",
        pricingMode: "day",
        status: "active",
        stockKind: "consumable",
        quantity: 5,
      });

      const realCustomer = nextId("tr_cus");
      const testCustomer = nextId("tr_cus");
      await louezDb.db.insert(louezDb.customers).values([
        { id: realCustomer, storeId, email: "ada@tr.test", firstName: "Ada", lastName: "Lovelace" },
        {
          id: testCustomer,
          storeId,
          email: "owner@tr.test",
          firstName: "Owen",
          lastName: "Owner",
          isTest: true,
        },
      ]);

      const real =
        options.withReal === false
          ? null
          : await booking(storeId, realCustomer, {
              status: options.realStatus ?? "confirmed",
              isTest: false,
              productId,
              unitId: unitIds[0] ?? "",
              consumableId,
            });
      const testRow = await booking(storeId, testCustomer, {
        status: options.testStatus ?? "confirmed",
        isTest: true,
        productId,
        unitId: unitIds[0] ?? "",
        consumableId,
      });
      return {
        storeId,
        productId,
        unitIds,
        consumableId,
        realCustomer,
        testCustomer,
        real,
        test: testRow,
      };
    }

    /** A fixture booking: one line on the unit, one on the consumable. */
    async function booking(
      storeId: string,
      customerId: string,
      options: {
        status: "pending" | "confirmed" | "completed";
        isTest: boolean;
        productId: string;
        unitId: string;
        consumableId: string;
      },
    ) {
      const id = nextId("tr_res");
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId,
        customerId,
        number: id,
        status: options.status,
        startDate: START,
        endDate: END,
        subtotalAmount: "25.00",
        depositAmount: "0.00",
        totalAmount: "25.00",
        source: "online",
        isTest: options.isTest,
      });
      const itemId = nextId("tr_itm");
      await louezDb.db.insert(louezDb.reservationItems).values([
        {
          id: itemId,
          reservationId: id,
          productId: options.productId,
          quantity: 1,
          unitPrice: "20.00",
          depositPerUnit: "0.00",
          totalPrice: "20.00",
          productSnapshot: { name: "Kayak", description: null, images: [] },
        },
        {
          id: nextId("tr_itm"),
          reservationId: id,
          productId: options.consumableId,
          quantity: 1,
          unitPrice: "5.00",
          depositPerUnit: "0.00",
          totalPrice: "5.00",
          productSnapshot: { name: "Sunscreen", description: null, images: [] },
        },
      ]);
      await louezDb.db.insert(louezDb.reservationItemUnits).values({
        id: nextId("tr_asg"),
        reservationItemId: itemId,
        productUnitId: options.unitId,
        identifierSnapshot: "K1",
      });
      return { id, itemId };
    }

    /** A completed rental payment on the reservation, cashed in now. */
    async function payment(reservationId: string, method: "cash" | "other", amount: string) {
      await louezDb.db.insert(louezDb.payments).values({
        id: nextId("tr_pay"),
        reservationId,
        amount,
        type: "rental",
        method,
        status: "completed",
        // Whole seconds: MySQL rounds a fraction up, past the `now` a test reads with.
        paidAt: new Date(Math.floor(Date.now() / 1000) * 1000),
      });
    }

    async function reservationRow(id: string) {
      const [row] = await louezDb.db
        .select({
          status: louezDb.reservations.status,
          internalNotes: louezDb.reservations.internalNotes,
          billableAt: louezDb.reservations.billableAt,
        })
        .from(louezDb.reservations)
        .where(orm.eq(louezDb.reservations.id, id));
      return row;
    }

    async function quantityOf(productId: string) {
      const [row] = await louezDb.db
        .select({ quantity: louezDb.products.quantity })
        .from(louezDb.products)
        .where(orm.eq(louezDb.products.id, productId));
      return row?.quantity;
    }

    async function queueRows(aggregateId: string) {
      return louezDb.db
        .select({ id: louezDb.billingSyncQueue.aggregateId })
        .from(louezDb.billingSyncQueue)
        .where(orm.eq(louezDb.billingSyncQueue.aggregateId, aggregateId));
    }

    // --- Callers --------------------------------------------------------------

    /** A person in the dashboard. */
    const session = (storeId: string): BaseContext => ({
      headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${storeId}` }),
      transport: "rpc",
      ports,
      receipt: {},
    });

    /** The in-app assistant, acting for the same session. */
    const assistant = (storeId: string): BaseContext => ({ ...session(storeId), assistant: true });

    /** An API key with every right on the store, over the REST API. */
    async function apiKey(storeId: string): Promise<BaseContext> {
      const created = await apiKeys.createApiKey({
        db: louezDb.db,
        storeId,
        userId: OWNER,
        name: "Agent key",
        permissions: {
          reservations: "write",
          products: "read",
          customers: "read",
          categories: "read",
          payments: "read",
          analytics: "read",
          settings: "read",
        },
      });
      return {
        headers: new Headers({ authorization: `Bearer ${created.key}` }),
        transport: "openapi",
        ports,
        receipt: {},
      };
    }

    /** An agent connected over OAuth (MCP), granted writes on the store. */
    async function oauthAgent(storeId: string): Promise<BaseContext> {
      const saved = await grants.saveGrant({
        userId: OWNER,
        clientId: CLIENT,
        terms: {
          stores: { all: false, ids: [storeId] },
          preset: "write",
          confirmSensitive: true,
          bundles: ["daily"],
        },
      });
      const token = await tokens.sign({ userId: OWNER, clientId: CLIENT, grantId: saved.id });
      return {
        headers: new Headers({ authorization: `Bearer ${token}`, "louez-store": storeId }),
        transport: "mcp",
        ports,
        receipt: {},
      };
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
        path: ["dashboard", "reservations"],
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
    }

    // --- TR1: no stock --------------------------------------------------------

    test("the test reservation makes no unit busy and shows in no unit conflict", async () => {
      const seeded = await seed();
      const unitId = seeded.unitIds[0] ?? "";

      const busyWithReal = await louezDb.findBusyUnitIds(louezDb.db, {
        unitIds: seeded.unitIds,
        start: START,
        end: END,
        blockingStatuses: ["pending", "confirmed", "ongoing"],
        turnoverBufferMinutes: 0,
      });
      assert.deepEqual([...busyWithReal.keys()], [unitId], "the real booking holds the unit");

      const conflicts = await unitConflicts.getUnitConflicts(
        unitId,
        { start: START, end: END },
        { storeId: seeded.storeId },
      );
      assert.deepEqual(
        conflicts.map((conflict) => conflict.reservationId),
        [seeded.real?.id],
        "only the real booking conflicts",
      );

      // With the real booking cancelled, the test reservation alone holds nothing.
      await louezDb.db
        .update(louezDb.reservations)
        .set({ status: "cancelled" })
        .where(orm.eq(louezDb.reservations.id, seeded.real?.id ?? ""));
      const busyTestOnly = await louezDb.findBusyUnitIds(louezDb.db, {
        unitIds: seeded.unitIds,
        start: START,
        end: END,
        blockingStatuses: ["pending", "confirmed", "ongoing"],
        turnoverBufferMinutes: 0,
      });
      assert.equal(busyTestOnly.size, 0);
      assert.deepEqual(
        await unitConflicts.getUnitConflicts(
          unitId,
          { start: START, end: END },
          { storeId: seeded.storeId },
        ),
        [],
      );
    });

    test("a unit's history shows the test reservation's assignment events, and a reservation gone's, only to a session", async () => {
      const seeded = await seed();
      const unitId = seeded.unitIds[0] ?? "";
      const event = (reservation: { id: string; itemId: string }) => ({
        id: nextId("tr_uev"),
        productUnitId: unitId,
        storeId: seeded.storeId,
        type: "assigned" as const,
        payload: { reservationId: reservation.id, reservationItemId: reservation.itemId },
      });
      const realEvent = event(seeded.real ?? { id: "", itemId: "" });
      const testEvent = event(seeded.test);
      // An event naming the test reservation's line alone.
      const itemOnlyEvent = {
        ...event(seeded.test),
        payload: { reservationItemId: seeded.test.itemId },
      };
      // An event naming a reservation gone: only a test reservation's purge deletes one.
      const goneEvent = event({ id: "tr_gone_reservation", itemId: "tr_gone_item" });
      // An event naming no reservation, as a downtime's.
      const unitEvent = { ...event(seeded.test), type: "downtime_declared" as const, payload: {} };
      await louezDb.db
        .insert(louezDb.productUnitEvents)
        .values([realEvent, testEvent, itemOnlyEvent, goneEvent, unitEvent]);

      const ids = (history: Awaited<ReturnType<typeof unitHistory.getProductUnitHistory>>) =>
        (history?.timeline ?? [])
          .map((entry) => (entry.kind === "event" ? entry.id : `asg:${entry.reservationId}`))
          .sort();

      const hidden = await unitHistory.getProductUnitHistory({
        storeId: seeded.storeId,
        unitId,
        testReservations: false,
      });
      assert.deepEqual(
        ids(hidden),
        [`asg:${seeded.real?.id}`, realEvent.id, unitEvent.id].sort(),
      );

      const seen = await unitHistory.getProductUnitHistory({
        storeId: seeded.storeId,
        unitId,
        testReservations: true,
      });
      assert.deepEqual(
        ids(seen),
        [
          `asg:${seeded.real?.id}`,
          `asg:${seeded.test.id}`,
          realEvent.id,
          testEvent.id,
          itemOnlyEvent.id,
          goneEvent.id,
          unitEvent.id,
        ].sort(),
      );
    });

    // --- TR3: no figure -------------------------------------------------------

    test("the home's counters and the sales figures leave the test reservation and its payment out", async () => {
      const seeded = await seed();
      await payment(seeded.real?.id ?? "", "cash", "25.00");
      // The simulated payment of the test checkout.
      await payment(seeded.test.id, "other", "25.00");
      const store = { id: seeded.storeId, settings };
      const now = new Date();

      const metrics = await storeMetrics.getStoreMetrics(
        { id: seeded.storeId, currency: "EUR" },
        { timezone: "UTC", now },
      );
      assert.equal(metrics.totalReservations, 1);
      assert.equal(metrics.confirmedReservations, 1);
      assert.equal(metrics.customerCount, 1, "the test customer is no customer");
      assert.equal(metrics.allTimeRevenue, 25);
      assert.equal(metrics.monthlyRevenue, 25);

      const stats = await analytics.dashboardStats(store, now);
      assert.equal(stats.reservations.total, 1);
      assert.equal(stats.customers.total, 1);
      assert.equal(stats.revenue.allTime, "25.00");

      const report = await analytics.revenueReport(store, { period: "30d" }, now);
      assert.equal(report.revenue, "25.00");
      assert.equal(report.paymentCount, 1);
      assert.deepEqual(
        report.byPaymentMethod.map((row) => row.method),
        ["cash"],
        "the simulated payment shows under no method",
      );

      const receipts = await sales.getReceiptTotals(
        { id: seeded.storeId, currency: "EUR" },
        { end: now },
      );
      assert.deepEqual(receipts, { revenue: 25, paymentCount: 1 });
    });

    test("a test reservation alone is no launch milestone", async () => {
      const seeded = await seed({ withReal: false });
      const state = await launch.readLaunchState(louezDb.db, seeded.storeId, {
        withMilestones: true,
        hostedBy: null,
      });
      assert.deepEqual(state.milestones, {
        firstReservation: false,
        firstCompletedReservation: false,
      });

      await louezDb.db
        .update(louezDb.reservations)
        .set({ status: "completed" })
        .where(orm.eq(louezDb.reservations.id, seeded.test.id));
      const completed = await launch.readLaunchState(louezDb.db, seeded.storeId, {
        withMilestones: true,
        hostedBy: null,
      });
      assert.deepEqual(completed.milestones, {
        firstReservation: false,
        firstCompletedReservation: false,
      });
    });

    // --- TR4: who sees it -----------------------------------------------------

    test("a person in the dashboard lists, counts, polls and reads the test reservation", async () => {
      const seeded = await seed({ realStatus: "pending", testStatus: "pending" });
      const context = session(seeded.storeId);

      const list = await run("list", {}, context);
      assert.deepEqual(
        list.items.map((item) => item.id).sort(),
        [seeded.real?.id, seeded.test.id].sort(),
      );
      assert.equal(list.counts.pending, 2);
      const searched = await run("list", { search: seeded.test.id }, context);
      assert.deepEqual(
        searched.items.map((item) => item.id),
        [seeded.test.id],
      );

      const poll = await run("poll", {}, context);
      assert.equal(poll.pendingCount, 2);
      assert.equal(poll.totalCount, 2);
      assert.equal(poll.counts.pending, 2);
      assert.ok(poll.pendingReservations.some((row) => row.id === seeded.test.id));

      const read = await run("get", { id: seeded.test.id }, context);
      assert.equal(read.id, seeded.test.id);
    });

    for (const [label, caller] of [
      ["an API key", (storeId: string) => apiKey(storeId)],
      ["an OAuth (MCP) connection", (storeId: string) => oauthAgent(storeId)],
      ["the in-app assistant", async (storeId: string) => assistant(storeId)],
    ] as const) {
      test(`${label} reads the store as if the test reservation did not exist`, async () => {
        const seeded = await seed({ realStatus: "pending", testStatus: "pending" });
        const context = await caller(seeded.storeId);

        const list = await run("list", {}, context);
        assert.deepEqual(
          list.items.map((item) => item.id),
          [seeded.real?.id],
        );
        assert.equal(list.counts.pending, 1);
        const searched = await run("list", { search: seeded.test.id }, context);
        assert.equal(searched.items.length, 0, "a search by its number finds nothing");

        const poll = await run("poll", {}, context);
        assert.equal(poll.pendingCount, 1);
        assert.equal(poll.totalCount, 1);
        assert.equal(poll.counts.pending, 1);
        assert.deepEqual(
          poll.pendingReservations.map((row) => row.id),
          [seeded.real?.id],
        );
        assert.equal(poll.latestReservation?.id, seeded.real?.id);

        await rejects(run("get", { id: seeded.test.id }, context), "RESERVATION_NOT_FOUND");
        assert.equal(
          (await run("get", { id: seeded.real?.id ?? "" }, context)).id,
          seeded.real?.id,
        );
      });
    }

    test("an API key naming the test reservation in a write gets not found, and nothing changes", async () => {
      const seeded = await seed({ testStatus: "pending" });
      const context = await apiKey(seeded.storeId);
      const id = seeded.test.id;

      await rejects(
        run("updateNotes", { id, notes: "agent was here" }, context),
        "RESERVATION_NOT_FOUND",
      );
      await rejects(run("cancel", { id }, context), "RESERVATION_NOT_FOUND");
      await rejects(
        run("updateStatus", { id, status: "confirmed" }, context),
        "RESERVATION_NOT_FOUND",
      );
      await rejects(
        run("updateStatus", { id, status: "rejected" }, context),
        "RESERVATION_NOT_FOUND",
      );

      const row = await reservationRow(id);
      assert.equal(row?.status, "pending");
      assert.equal(row?.internalNotes ?? null, null);
      const activity = await louezDb.db
        .select({ id: louezDb.reservationActivity.id })
        .from(louezDb.reservationActivity)
        .where(orm.eq(louezDb.reservationActivity.reservationId, id));
      assert.equal(activity.length, 0);
      const effects = await louezDb.db
        .select({ id: louezDb.apiEffects.id })
        .from(louezDb.apiEffects)
        .where(orm.eq(louezDb.apiEffects.storeId, seeded.storeId));
      assert.equal(effects.length, 0);
    });

    // --- TR1 (consumables) and TR2 (billing) ---------------------------------

    test("confirming a test reservation from the dashboard takes no consumable", async () => {
      const seeded = await seed({ withReal: false, testStatus: "pending" });
      assert.equal(await quantityOf(seeded.consumableId), 5);

      const change = await run(
        "updateStatus",
        { id: seeded.test.id, status: "confirmed" },
        session(seeded.storeId),
      );
      assert.equal(change.to, "confirmed");
      assert.equal((await reservationRow(seeded.test.id))?.status, "confirmed");
      assert.equal(await quantityOf(seeded.consumableId), 5, "the consumable stays in stock");

      // The same path takes the consumable for a real booking.
      const real = await booking(seeded.storeId, seeded.realCustomer, {
        status: "pending",
        isTest: false,
        productId: seeded.productId,
        unitId: seeded.unitIds[1] ?? "",
        consumableId: seeded.consumableId,
      });
      await run("updateStatus", { id: real.id, status: "confirmed" }, session(seeded.storeId));
      assert.equal(await quantityOf(seeded.consumableId), 4);
    });

    test("a test reservation inserted and confirmed is never billed", async (t) => {
      const saved = new Map(BILLING_ENV.map((name) => [name, process.env[name]]));
      t.after(() => {
        for (const [name, value] of saved) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      });
      // Service mode, with this store before the cutoff: its card gate is open.
      process.env.LOUEZ_BILLING = "cloud";
      process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
      process.env.BILLING_NEW_STORES_FROM = "2099-01-01T00:00:00Z";
      assert.ok(louezDb.isBillingSyncEnabled());

      const seeded = await seed({ withReal: false });
      await louezDb.db
        .delete(louezDb.reservations)
        .where(orm.eq(louezDb.reservations.id, seeded.test.id));

      const insert = (id: string, isTest: boolean, customerId: string) =>
        louezDb.db.transaction((tx) =>
          louezDb.insertReservation(tx, {
            id,
            storeId: seeded.storeId,
            customerId,
            number: id,
            status: "pending",
            source: "online",
            startDate: START,
            endDate: END,
            subtotalAmount: "10.00",
            depositAmount: "0.00",
            totalAmount: "10.00",
            isTest,
          }),
        );
      const confirm = (id: string) =>
        louezDb.runReservationChange({ reservationId: id, storeId: seeded.storeId }, (tx, lock) =>
          louezDb.changeReservationStatus(tx, {
            lock,
            reservationId: id,
            storeId: seeded.storeId,
            to: "confirmed",
            actor: "store_user",
            actorUserId: OWNER,
            now: new Date(),
          }),
        );

      const testId = nextId("tr_res");
      const realId = nextId("tr_res");
      await insert(testId, true, seeded.testCustomer);
      await insert(realId, false, seeded.realCustomer);
      assert.equal((await queueRows(testId)).length, 0, "the test insert marks nothing");
      assert.equal((await queueRows(realId)).length, 1, "a real insert is marked");

      await confirm(testId);
      await confirm(realId);
      const testRow = await reservationRow(testId);
      assert.equal(testRow?.status, "confirmed");
      assert.equal(testRow?.billableAt, null);
      assert.equal((await queueRows(testId)).length, 0, "the test confirmation marks nothing");
      assert.ok((await reservationRow(realId))?.billableAt, "a real confirmation is billable");

      // Inserted straight as confirmed: still no billing date, no mark.
      const confirmedId = nextId("tr_res");
      await louezDb.db.delete(louezDb.reservations).where(orm.eq(louezDb.reservations.id, testId));
      await louezDb.db.transaction((tx) =>
        louezDb.insertReservation(tx, {
          id: confirmedId,
          storeId: seeded.storeId,
          customerId: seeded.testCustomer,
          number: confirmedId,
          status: "confirmed",
          source: "online",
          startDate: START,
          endDate: END,
          subtotalAmount: "10.00",
          depositAmount: "0.00",
          totalAmount: "10.00",
          isTest: true,
        }),
      );
      assert.equal((await reservationRow(confirmedId))?.billableAt, null);
      assert.equal((await queueRows(confirmedId)).length, 0);

      // A later write that marks by reservation (a payment, an edit, a refund).
      await louezDb.db.transaction(async (tx) => {
        await louezDb.markReservation(tx, { id: confirmedId, storeId: seeded.storeId });
        await louezDb.markReservation(tx, { id: realId, storeId: seeded.storeId });
      });
      assert.equal((await queueRows(confirmedId)).length, 0, "a test reservation is never marked");
      assert.equal((await queueRows(realId)).length, 1);
    });
  },
);
