import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnLockedRow,
  raceOnOpenTransaction,
  readLockWaiters,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type TestDatabase,
} from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { ApiEvent } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "reservation-create-test-secret";
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

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@rc.test` } } : null;
        },
      },
    },
  },
});

// The store's creation of a reservation (`reservations.create`) through its
// procedure, on the database: what it refuses before anything is asked, the
// stock as a confirmation checks it, the customer and the number under
// concurrent creations, who is asked, the replay of a key, and the outbox.

const OWNER = "rc_owner_user_000001";
const STORE = "rc_store_a_000000001";
const OTHER_STORE = "rc_store_b_000000001";
const CUSTOMER = "rc_customer_00000001";
const OTHER_CUSTOMER = "rc_customer_00000002";

const START = "2030-06-01T09:00:00+00:00";
const END = "2030-06-03T09:00:00+00:00";

describe(
  "the store's creation of a reservation (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orpc: typeof import("@orpc/server");
    let orm: typeof import("drizzle-orm");
    let apiKeys: typeof import("../../services/api-keys");
    let router: typeof import("./reservations").dashboardReservationsRouter;
    let handoffsRouter: typeof import("./handoffs").dashboardHandoffsRouter;

    const events: ApiEvent[] = [];
    const feeEffects: unknown[][] = [];
    const dispatched: string[] = [];
    let emailConfigured = true;
    const ports = {
      planFeatures: async () => ({ apiAccess: true }),
      storage: createMemoryStorage(),
      urls: createTestUrls(),
      afterCommit: (event: ApiEvent) => {
        events.push(event);
      },
      runReservationEffects: async (effects: readonly unknown[]) => {
        feeEffects.push([...effects]);
      },
      insurance: { createContract: async () => null, cancelContract: async () => {} },
      newStores: createTestNewStores(),
      dispatchEffects: (ids: readonly string[]) => {
        dispatched.push(...ids);
      },
      emailConfigured: () => emailConfigured,
    };

    const settings = {
      reservationMode: "request" as const,
      currency: "EUR",
      pendingBlocksAvailability: true,
      advanceNoticeMinutes: 0,
      minRentalMinutes: 0,
      turnoverBufferMinutes: 0,
    };

    before(async () => {
      database = await createTestDatabase("api_reservation_create");
      louezDb = await import("@louez/db");
      orpc = await import("@orpc/server");
      orm = await import("drizzle-orm");
      apiKeys = await import("../../services/api-keys");
      ({ dashboardReservationsRouter: router } = await import("./reservations"));
      ({ dashboardHandoffsRouter: handoffsRouter } = await import("./handoffs"));

      await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@rc.test" });
      await louezDb.db.insert(louezDb.stores).values([
        { id: STORE, userId: OWNER, name: "A store", slug: "rc-store-a", settings },
        { id: OTHER_STORE, userId: OWNER, name: "B store", slug: "rc-store-b", settings },
      ]);
      await louezDb.db.insert(louezDb.storeMembers).values([
        { storeId: STORE, userId: OWNER, role: "owner" },
        { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
      ]);
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      events.length = 0;
      feeEffects.length = 0;
      dispatched.length = 0;
      emailConfigured = true;
      for (const table of [
        louezDb.apiEffects,
        louezDb.apiOperations,
        louezDb.apiConfirmations,
        louezDb.apiHandoffs,
        louezDb.reservationActivity,
        louezDb.reservationItems,
        louezDb.reservations,
        louezDb.productAccessories,
        louezDb.products,
        louezDb.customers,
      ]) {
        await louezDb.db.delete(table);
      }
      await louezDb.db.insert(louezDb.customers).values([
        {
          id: CUSTOMER,
          storeId: STORE,
          email: "ada@rc.test",
          firstName: "Ada",
          lastName: "Lovelace",
          phone: "+33600000001",
        },
        {
          id: OTHER_CUSTOMER,
          storeId: OTHER_STORE,
          email: "grace@rc.test",
          firstName: "Grace",
          lastName: "Hopper",
        },
      ]);
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings, customerNotificationSettings: null })
        .where(orm.eq(louezDb.stores.id, STORE));
    });

    // --- Callers --------------------------------------------------------------

    function session() {
      return {
        headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${STORE}` }),
        transport: "rpc" as const,
        ports,
        receipt: {},
      };
    }

    type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
    const everything: Permissions = {
      reservations: "write",
      products: "read",
      customers: "write",
      categories: "read",
      payments: "read",
      analytics: "read",
      settings: "read",
    };

    async function agentKey(
      options: { confirmSensitive?: boolean; permissions?: Permissions } = {},
    ) {
      const created = await apiKeys.createApiKey({
        db: louezDb.db,
        storeId: STORE,
        userId: OWNER,
        name: "Booking agent",
        permissions: options.permissions ?? everything,
      });
      if (options.confirmSensitive === false) {
        await louezDb.db
          .update(louezDb.apiKeys)
          .set({ confirmSensitive: false })
          .where(orm.eq(louezDb.apiKeys.id, created.id));
      }
      return {
        id: created.id,
        call: (extra: Record<string, string> = {}) => ({
          headers: new Headers({ authorization: `Bearer ${created.key}`, ...extra }),
          transport: "openapi" as const,
          ports,
          receipt: {} as { operationId?: string; replayed?: boolean },
        }),
      };
    }

    type Client = RouterClient<typeof router>;
    type CreateInput = Parameters<Client["create"]>[0];

    function create(input: CreateInput, context: BaseContext) {
      const client = orpc.createRouterClient(router, {
        context,
        path: ["dashboard", "reservations"],
      }) as Client;
      return client.create(input);
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

    /** The owner approves the request on its page, the box ticked: the approval's id. */
    async function approvedOf(refusal: { data: { details?: Record<string, unknown> } }) {
      const id = String((refusal.data.details?.approval as { id?: string } | undefined)?.id);
      const [row] = await louezDb.db
        .select()
        .from(louezDb.apiHandoffs)
        .where(orm.eq(louezDb.apiHandoffs.id, id));
      assert.ok(row, `approval ${id}`);
      await orpc.call(
        handoffsRouter.decide,
        {
          id,
          decision: "approve",
          revision: row.revision,
          shown: String(row.bindingHash),
          acknowledged: true,
        },
        { context: session(), path: ["dashboard", "handoffs", "decide"] },
      );
      return id;
    }

    // --- Fixtures -------------------------------------------------------------

    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(12, "0")}`;

    async function product(
      options: {
        quantity?: number;
        stockKind?: "returnable" | "consumable" | "untracked";
        status?: "active" | "draft" | "archived";
        store?: string;
        price?: string;
      } = {},
    ) {
      const id = nextId("rc_prd");
      await louezDb.db.insert(louezDb.products).values({
        id,
        storeId: options.store ?? STORE,
        name: `Kayak ${id}`,
        price: options.price ?? "10.00",
        deposit: "50.00",
        pricingMode: "day",
        stockKind: options.stockKind ?? "returnable",
        quantity: options.quantity ?? 1,
        status: options.status ?? "active",
      });
      return id;
    }

    /** Another booking of the store, confirmed, holding `quantity` of the product. */
    async function booking(productId: string, start: string, end: string, quantity = 1) {
      const id = nextId("rc_res");
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: STORE,
        customerId: CUSTOMER,
        number: id,
        status: "confirmed",
        startDate: new Date(start),
        endDate: new Date(end),
        subtotalAmount: "20.00",
        depositAmount: "0.00",
        totalAmount: "20.00",
        source: "manual",
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: nextId("rc_itm"),
        reservationId: id,
        productId,
        quantity,
        unitPrice: "10.00",
        depositPerUnit: "0.00",
        totalPrice: "20.00",
        productSnapshot: { name: "Kayak", description: null, images: [] },
      });
      return id;
    }

    const base = (productId: string, extra: Partial<CreateInput> = {}): CreateInput => ({
      customer: { id: CUSTOMER },
      startDate: START,
      endDate: END,
      lines: [{ productId, quantity: 1 }],
      status: "quote",
      notifyCustomer: false,
      ...extra,
    });

    const reservationsOfStore = () =>
      louezDb.db
        .select()
        .from(louezDb.reservations)
        .where(orm.eq(louezDb.reservations.storeId, STORE));
    const created = async () =>
      (await reservationsOfStore()).filter(
        (row) => row.source === "manual" && row.number.startsWith("R"),
      );
    const outbox = () =>
      louezDb.db
        .select({ type: louezDb.apiEffects.type, payload: louezDb.apiEffects.payload })
        .from(louezDb.apiEffects)
        .orderBy(louezDb.apiEffects.seq);
    /** The creation's own activity row: a confirmed booking's contract validation adds one of its own. */
    const activityOf = async (reservationId: string) =>
      louezDb.db
        .select()
        .from(louezDb.reservationActivity)
        .where(
          orm.and(
            orm.eq(louezDb.reservationActivity.reservationId, reservationId),
            orm.eq(louezDb.reservationActivity.activityType, "created"),
          ),
        );

    // --- What it writes ---------------------------------------------------------

    test("a session creates a quote: priced from the catalog, no stock taken, nothing asked", async () => {
      const kayak = await product({ quantity: 3 });
      const answer = await create(
        base(kayak, { lines: [{ productId: kayak, quantity: 2 }] }),
        session(),
      );

      assert.equal(answer.reservation.status, "quote");
      assert.match(answer.reservation.number, /^R\d{4}-\d{4}$/);
      assert.equal(answer.id, answer.reservation.id);
      assert.deepEqual(answer.customer, { id: CUSTOMER, created: false });
      // Two days of a 10.00 product, two of them.
      assert.equal(answer.reservation.totalAmount, "40.00");
      assert.equal(answer.reservation.depositAmount, "100.00");
      assert.deepEqual(answer.capacity, {
        overbooked: false,
        shortfalls: [],
        pastTurnoverBuffer: [],
      });
      assert.deepEqual(answer.message, { sent: false, kind: null, to: null, reason: "not_asked" });
      assert.ok(answer.links.dashboard.includes(answer.id));

      const [row] = await created();
      assert.equal(row?.source, "manual");
      assert.equal(row?.currency, "EUR");
      assert.equal(row?.deliveryOption, "pickup");
      assert.equal(row?.pickupLocationSnapshot?.type, "primary");
      assert.equal(row?.billableAt, null, "a quote is not billable");
      const [activity] = await activityOf(answer.id);
      assert.equal(activity?.activityType, "created");
      assert.equal(activity?.userId, OWNER);
      assert.deepEqual(
        {
          status: activity?.metadata?.status,
          credential: activity?.metadata?.credential,
          overbooked: activity?.metadata?.overbooked,
          channel: activity?.metadata?.channel,
        },
        {
          status: "quote",
          credential: { kind: "session", id: null },
          overbooked: false,
          channel: "rpc",
        },
      );
      assert.deepEqual(feeEffects, [[]], "a quote records no fee");
      assert.deepEqual(
        (await outbox()).map((effect) => effect.type),
        ["reservation.createdPlatformNotification", "reservation.createdPlatformNotification"],
        "the platform's notices, and no customer message",
      );
      assert.equal(
        events.find((event) => event.type === "reservation.created")?.type,
        "reservation.created",
      );
    });

    test("a confirmed booking takes its consumables and records its fee, as a confirmation does", async () => {
      const kayak = await product({ quantity: 1 });
      const paddles = await product({ quantity: 5, stockKind: "consumable" });
      const answer = await create(
        base(kayak, {
          status: "confirmed",
          lines: [
            { productId: kayak, quantity: 1 },
            { productId: paddles, quantity: 2 },
          ],
        }),
        session(),
      );
      assert.equal(answer.reservation.status, "confirmed");
      const [paddle] = await louezDb.db
        .select({ quantity: louezDb.products.quantity })
        .from(louezDb.products)
        .where(orm.eq(louezDb.products.id, paddles));
      assert.equal(paddle?.quantity, 3, "two consumables taken");
      const [row] = await created();
      assert.ok(row?.billableAt, "a confirmed booking is billable from its creation");
      assert.equal((feeEffects[0] as Array<{ type: string }>)[0]?.type, "legacy_fee.record");
    });

    // --- Refusals, before anything is asked -------------------------------------

    test("pending and each option this version leaves to the dashboard are refused by name, nothing written", async () => {
      const kayak = await product();
      const cases: Array<[Partial<CreateInput>, string]> = [
        [{ status: "pending" }, "pending"],
        [{ customLines: [{ name: "Cleaning", unitPrice: 10 }] }, "custom_lines"],
        [{ lines: [{ productId: kayak, quantity: 1, unitPrice: "5.00" }] }, "price_override"],
        [{ depositOverride: "0.00" }, "deposit_override"],
        [{ discountAmount: 5 }, "discount"],
        [{ promoCode: "SUMMER" }, "promo_code"],
        [{ delivery: { outbound: { method: "address" } } }, "delivery"],
        [{ insurance: true }, "insurance"],
        [{ tulipInsuranceOptIn: true }, "insurance"],
      ];
      const agent = await agentKey();
      for (const [extra, option] of cases) {
        const refusal = await rejects(
          create(
            base(kayak, extra),
            agent.call({ "idempotency-key": `opt-${option}-${counter++}` }),
          ),
          "RESERVATION_OPTION_NOT_AVAILABLE",
        );
        assert.equal(refusal.data.details?.option, option);
      }
      assert.deepEqual(await created(), []);
      assert.deepEqual(
        await louezDb.db.select().from(louezDb.apiConfirmations),
        [],
        "nothing asked",
      );
    });

    test("a window that does not move forward, another store's product or customer, a product not active are refused", async () => {
      const kayak = await product();
      await rejects(
        create(base(kayak, { endDate: START }), session()),
        "RESERVATION_WINDOW_INVALID",
      );
      const theirs = await product({ store: OTHER_STORE });
      const notFound = await rejects(create(base(theirs), session()), "PRODUCT_NOT_FOUND");
      assert.equal(notFound.data.details?.id, theirs);
      await rejects(
        create(base(kayak, { customer: { id: OTHER_CUSTOMER } }), session()),
        "CUSTOMER_NOT_FOUND",
      );
      for (const status of ["archived", "draft"] as const) {
        const shelved = await product({ status });
        const refusal = await rejects(
          create(base(shelved), session()),
          "RESERVATION_PRODUCT_NOT_BOOKABLE",
        );
        assert.equal(refusal.data.details?.status, status);
      }
      assert.deepEqual(await created(), []);
    });

    test("a store that requires insurance on every booking is refused, saying so", async () => {
      const kayak = await product();
      const integration = nextId("rc_int");
      await louezDb.db.insert(louezDb.storeIntegrations).values({
        id: integration,
        storeId: STORE,
        providerKey: "tulip",
        category: "insurance",
        enabled: true,
      });
      await louezDb.db.insert(louezDb.storeTulipIntegrations).values({
        id: nextId("rc_tul"),
        integrationId: integration,
        renterUid: "renter-1",
        publicMode: "required",
      });
      try {
        const refusal = await rejects(
          create(base(kayak), session()),
          "RESERVATION_OPTION_NOT_AVAILABLE",
        );
        assert.equal(refusal.data.details?.option, "insurance");
        assert.match((refusal as unknown as Error).message, /requires insurance on every booking/);
      } finally {
        await louezDb.db.delete(louezDb.storeTulipIntegrations);
        await louezDb.db.delete(louezDb.storeIntegrations);
      }
    });

    test("a cart without its required accessory is refused, naming the accessory to add", async () => {
      const bike = await product({ quantity: 2 });
      const helmet = await product({ quantity: 5 });
      await louezDb.db.insert(louezDb.productAccessories).values({
        id: nextId("rc_acc"),
        productId: bike,
        accessoryId: helmet,
        required: true,
        quantity: 1,
      });
      const refusal = await rejects(
        create(base(bike, { lines: [{ productId: bike, quantity: 2 }] }), session()),
        "RESERVATION_REQUIRED_ACCESSORIES_MISSING",
      );
      const [missing] = (refusal.data.details?.missing ?? []) as Array<Record<string, unknown>>;
      assert.equal(missing?.accessoryProductId, helmet);
      assert.equal(missing?.requiredQuantity, 2);
      assert.equal(missing?.providedQuantity, 0);
      assert.match(String(missing?.accessoryName), /^Kayak rc_prd/);

      const answer = await create(
        base(bike, {
          lines: [
            { productId: bike, quantity: 2 },
            { productId: helmet, quantity: 2 },
          ],
        }),
        session(),
      );
      assert.equal(answer.reservation.items.length, 2);
    });

    // --- Stock, as a confirmation checks it ---------------------------------------

    test("a full day is refused with its shortfalls; allowOverbooking books over it and records it", async () => {
      const kayak = await product({ quantity: 1 });
      await booking(kayak, START, END);
      const refusal = await rejects(
        create(base(kayak), session()),
        "RESERVATION_INSUFFICIENT_CAPACITY",
      );
      assert.deepEqual(
        ((refusal.data.details?.shortfalls ?? []) as Array<Record<string, unknown>>).map(
          (shortfall) => ({
            line: shortfall.line,
            requested: shortfall.requested,
            available: shortfall.available,
          }),
        ),
        [{ line: 0, requested: 1, available: 0 }],
      );
      // A turnover buffer flag does not pass a shortfall of the stock itself.
      await rejects(
        create(base(kayak, { overrideTurnoverBuffer: true }), session()),
        "RESERVATION_INSUFFICIENT_CAPACITY",
      );
      assert.deepEqual(await created(), []);

      const answer = await create(
        base(kayak, { allowOverbooking: true, status: "confirmed" }),
        session(),
      );
      assert.equal(answer.capacity.overbooked, true);
      assert.equal(answer.capacity.shortfalls[0]?.available, 0);
      const [activity] = await activityOf(answer.id);
      assert.equal(activity?.metadata?.overbooked, true);
      assert.equal(((activity?.metadata?.overbookingShortfalls ?? []) as unknown[]).length, 1);
    });

    test("a line short only with the turnover buffer: refused, allowOverbooking does not pass it, its own flag does", async () => {
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: { ...settings, turnoverBufferMinutes: 120 } })
        .where(orm.eq(louezDb.stores.id, STORE));
      const kayak = await product({ quantity: 1 });
      // Back an hour before this one starts: inside the two-hour buffer.
      await booking(kayak, "2030-05-30T09:00:00Z", "2030-06-01T08:00:00Z");

      await rejects(create(base(kayak), session()), "RESERVATION_TURNOVER_BUFFER_CONFLICT");
      await rejects(
        create(base(kayak, { allowOverbooking: true }), session()),
        "RESERVATION_TURNOVER_BUFFER_CONFLICT",
      );
      assert.deepEqual(await created(), []);

      const answer = await create(base(kayak, { overrideTurnoverBuffer: true }), session());
      assert.equal(answer.capacity.overbooked, false, "the buffer is no overbooking");
      assert.equal(answer.capacity.pastTurnoverBuffer.length, 1);
      const [activity] = await activityOf(answer.id);
      assert.equal(activity?.metadata?.overbooked, false);
      assert.equal(activity?.metadata?.turnoverBufferOverridden, true);
      assert.equal(activity?.metadata?.turnoverBufferMinutes, 120);
    });

    test("a consumable short on hand is refused whatever the flags", async () => {
      const paddles = await product({ quantity: 1, stockKind: "consumable" });
      for (const status of ["quote", "confirmed"] as const) {
        const refusal = await rejects(
          create(
            base(paddles, {
              status,
              lines: [{ productId: paddles, quantity: 2 }],
              allowOverbooking: true,
              overrideTurnoverBuffer: true,
            }),
            session(),
          ),
          "RESERVATION_ITEMS_UNAVAILABLE",
        );
        assert.equal(
          (refusal as unknown as { data: { i18nKey: string } }).data.i18nKey,
          "errors.consumableInsufficientStock",
        );
      }
      assert.deepEqual(await created(), []);
    });

    test("two creations racing for the last unit: one is created, the other refused with its shortfall", async () => {
      const kayak = await product({ quantity: 1 });
      const results = await raceOnLockedRow(database, { table: "products", id: kayak }, [
        () =>
          create(base(kayak, { status: "confirmed" }), session()).then(
            () => "created",
            (error) => error.data?.code,
          ),
        () =>
          create(base(kayak, { status: "confirmed" }), session()).then(
            () => "created",
            (error) => error.data?.code,
          ),
      ]);
      assert.deepEqual([...results].sort(), ["RESERVATION_INSUFFICIENT_CAPACITY", "created"]);
      assert.equal((await created()).length, 1);
    });

    test("its locks: the store row, then the products by id, before any row of the reservation's own", async () => {
      const [low, high] = [await product({ quantity: 5 }), await product({ quantity: 5 })].sort();
      assert.ok(low && high);
      for (const held of ["stores", high] as const) {
        const holder = await database.connect();
        try {
          await holder.beginTransaction();
          if (held === "stores")
            await holder.query("SELECT id FROM stores WHERE id = ? FOR UPDATE", [STORE]);
          else await holder.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [held]);
          const running = create(
            base(low, {
              lines: [
                { productId: high, quantity: 1 },
                { productId: low, quantity: 1 },
              ],
            }),
            session(),
          );
          await waitForLockWaits(holder, database.name, 1);
          const [waiter] = await readLockWaiters(holder, database.name);
          if (held === "stores") {
            // Its first lock: it holds nothing yet.
            assert.deepEqual(waiter?.waitsFor, [{ table: "stores", id: STORE }]);
            assert.deepEqual(waiter?.holds, []);
          } else {
            // The store, then the lower product, while it waits for the higher one; nothing of a reservation or a customer.
            assert.deepEqual(waiter?.waitsFor, [{ table: "products", id: high }]);
            assert.deepEqual(
              [...(waiter?.holds ?? [])].sort((a, b) => a.table.localeCompare(b.table)),
              [
                { table: "products", id: low },
                { table: "stores", id: STORE },
              ],
            );
          }
          await holder.commit();
          await running;
        } finally {
          await holder.end();
        }
      }
    });

    // --- The customer --------------------------------------------------------------

    test("a new e-mail adds the customer; one the store has is used as is, never overwritten", async () => {
      const kayak = await product({ quantity: 5 });
      const added = await create(
        base(kayak, {
          customer: {
            email: " Nina.Roux@RC.test ",
            firstName: "Nina",
            lastName: "Roux",
            phone: "+33600000002",
          },
        }),
        session(),
      );
      assert.equal(added.customer.created, true);
      const [nina] = await louezDb.db
        .select()
        .from(louezDb.customers)
        .where(orm.eq(louezDb.customers.id, added.customer.id));
      assert.equal(nina?.email, "nina.roux@rc.test");
      assert.equal(nina?.createdVia, "dashboard");

      const reused = await create(
        base(kayak, { customer: { email: "ADA@rc.test", firstName: "Someone", lastName: "Else" } }),
        session(),
      );
      assert.deepEqual(reused.customer, { id: CUSTOMER, created: false });
      const [ada] = await louezDb.db
        .select()
        .from(louezDb.customers)
        .where(orm.eq(louezDb.customers.id, CUSTOMER));
      assert.equal(`${ada?.firstName} ${ada?.lastName}`, "Ada Lovelace", "not overwritten");
    });

    test("creations racing on one new e-mail end with one customer and every booking, no duplicate-key error", async () => {
      const one = await product({ quantity: 5 });
      const two = await product({ quantity: 5 });
      const email = "race@rc.test";
      const winner = nextId("rc_cus");
      // Another write adds the e-mail and holds it uncommitted while both creations try to.
      const results = await raceOnOpenTransaction(
        database,
        async (holder) => {
          await holder.query(
            "INSERT INTO customers (id, store_id, email, first_name, last_name) VALUES (?, ?, ?, 'First', 'Writer')",
            [winner, STORE, email],
          );
        },
        [one, two].map(
          (productId) => () =>
            create(
              base(productId, { customer: { email, firstName: "Late", lastName: "Comer" } }),
              session(),
            ),
        ),
      );
      assert.deepEqual(
        results.map((answer) => answer.customer),
        [
          { id: winner, created: false },
          { id: winner, created: false },
        ],
      );
      const rows = await louezDb.db
        .select()
        .from(louezDb.customers)
        .where(orm.eq(louezDb.customers.email, email));
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.firstName, "First", "the first writer's details stay");
      assert.equal((await created()).length, 2);
    });

    // --- The number ------------------------------------------------------------------

    test("two creations at once never share a number, even when they draw the same one", async (t) => {
      // Two products: the creations share no product lock, only the store's.
      const one = await product({ quantity: 5 });
      const two = await product({ quantity: 5 });
      // Every draw is the same: only the check under the store's lock tells them apart.
      t.mock.method(
        globalThis.crypto,
        "getRandomValues",
        <T extends ArrayBufferView | null>(array: T) => {
          if (array instanceof Uint32Array) array.fill(4242);
          return array;
        },
      );
      // The holder takes the store row and both products: each creation waits on its first lock.
      const answers = await raceOnOpenTransaction(
        database,
        async (holder) => {
          await holder.query("SELECT id FROM stores WHERE id = ? FOR UPDATE", [STORE]);
          await holder.query("SELECT id FROM products WHERE id IN (?, ?) ORDER BY id FOR UPDATE", [
            one,
            two,
          ]);
        },
        [one, two].map((productId) => () => create(base(productId), session())),
      );
      const numbers = answers.map((answer) => answer.reservation.number);
      assert.equal(new Set(numbers).size, 2, numbers.join(", "));
      const month = `${String(new Date().getFullYear()).slice(-2)}${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      assert.ok(numbers.includes(`R${month}-4242`), numbers.join(", "));
    });

    // --- Who is asked ------------------------------------------------------------------

    test("a key asks for confirmation when its option is on, runs at once when off; a session is never asked", async () => {
      const kayak = await product({ quantity: 5 });
      const asking = await agentKey();
      const refusal = await rejects(
        create(base(kayak), asking.call({ "idempotency-key": "ask-1" })),
        "CONFIRMATION_REQUIRED",
      );
      assert.deepEqual(await created(), [], "the first call creates nothing");
      const preview = (refusal.data.details as { preview: { details: Record<string, unknown> } })
        .preview;
      assert.equal((preview.details.totals as { total: string }).total, "20.00");
      assert.equal((preview.details.customer as { email: string }).email, "ada@rc.test");

      // The same key, the token: the first answer was a refusal, so the key runs it.
      const answer = await create(
        base(kayak),
        asking.call({ "idempotency-key": "ask-1", "louez-confirmation": tokenOf(refusal) }),
      );
      assert.equal(answer.reservation.status, "quote");
      const [activity] = await activityOf(answer.id);
      assert.deepEqual(activity?.metadata?.credential, { kind: "api_key", id: asking.id });

      const silent = await agentKey({ confirmSensitive: false });
      await create(base(kayak), silent.call({ "idempotency-key": "silent-1" }));
      assert.equal((await created()).length, 2);
    });

    test("an override asks a person, whatever the option; a booking that lands after the approval voids it", async () => {
      for (const confirmSensitive of [true, false]) {
        await louezDb.db.delete(louezDb.reservations);
        await louezDb.db.delete(louezDb.reservationItems);
        const kayak = await product({ quantity: 2 });
        await booking(kayak, START, END);
        const agent = await agentKey({ confirmSensitive });
        const input = base(kayak, {
          lines: [{ productId: kayak, quantity: 2 }],
          allowOverbooking: true,
        });

        const asked = await rejects(
          create(input, agent.call({ "idempotency-key": `over-${confirmSensitive}` })),
          "APPROVAL_REQUIRED",
        );
        const approval = await approvedOf(asked);
        // Another booking takes the second kayak: the shortfall grew.
        await booking(kayak, START, END);
        const voided = await rejects(
          create(
            input,
            agent.call({
              "idempotency-key": `over-${confirmSensitive}`,
              "louez-confirmation": approval,
            }),
          ),
          "APPROVAL_INVALID",
        );
        assert.equal(voided.data.details?.reason, "state_changed");
        assert.deepEqual(await created(), []);

        // Asked again, approved, carried out once.
        const again = await rejects(
          create(input, agent.call({ "idempotency-key": `over2-${confirmSensitive}` })),
          "APPROVAL_REQUIRED",
        );
        const second = await approvedOf(again);
        const answer = await create(
          input,
          agent.call({
            "idempotency-key": `over2-${confirmSensitive}`,
            "louez-confirmation": second,
          }),
        );
        assert.equal(answer.capacity.shortfalls[0]?.available, 0);
        const used = await rejects(
          create(
            input,
            agent.call({
              "idempotency-key": `over3-${confirmSensitive}`,
              "louez-confirmation": second,
            }),
          ),
          "APPROVAL_INVALID",
        );
        assert.equal(used.data.details?.reason, "used");
        assert.equal((await created()).length, 1);
      }
    });

    async function approvedForNewCustomer(email: string, key: string) {
      const kayak = await product({ quantity: 5 });
      const agent = await agentKey();
      const input = base(kayak, {
        customer: { email, firstName: "Alice", lastName: "New" },
        allowOverbooking: true,
      });
      const asked = await rejects(
        create(input, agent.call({ "idempotency-key": key })),
        "APPROVAL_REQUIRED",
      );
      return { agent, input, approval: await approvedOf(asked) };
    }
    const handoffStatus = async (id: string) =>
      (
        await louezDb.db
          .select({ status: louezDb.apiHandoffs.status })
          .from(louezDb.apiHandoffs)
          .where(orm.eq(louezDb.apiHandoffs.id, id))
      )[0]?.status;

    test("the customer approved is the customer written: an e-mail taken before the carry-out reads it", async () => {
      const email = "alice-before@rc.test";
      const { agent, input, approval } = await approvedForNewCustomer(email, "bound-1");
      // Bob takes the e-mail in a transaction still open: the carry-out's read waits for it.
      const bob = nextId("rc_cus");
      const [refusal] = await raceOnOpenTransaction(
        database,
        async (holder) => {
          await holder.query(
            "INSERT INTO customers (id, store_id, email, first_name, last_name) VALUES (?, ?, ?, 'Bob', 'Other')",
            [bob, STORE, email],
          );
        },
        [
          () =>
            rejects(
              create(
                input,
                agent.call({ "idempotency-key": "bound-1", "louez-confirmation": approval }),
              ),
              "APPROVAL_INVALID",
            ),
        ],
      );
      // Read after Bob committed, the request is another one: for Bob, not for a new Alice.
      assert.equal(refusal?.data.details?.reason, "other_request");
      assert.deepEqual(await created(), [], "nothing created, for Bob or anyone");
      assert.equal(await handoffStatus(approval), "approved", "the approval was not used");
      const again = await rejects(
        create(input, agent.call({ "idempotency-key": "bound-2" })),
        "APPROVAL_REQUIRED",
      );
      const preview = (again.data.details as { preview: { details: { customer: unknown } } })
        .preview;
      assert.deepEqual(preview.details.customer, {
        id: bob,
        created: false,
        name: "Bob Other",
        email,
      });
    });

    test("the customer approved is the customer written: an e-mail taken after the carry-out read it voids the approval", async () => {
      const email = "alice-after@rc.test";
      const { agent, input, approval } = await approvedForNewCustomer(email, "bound-3");
      const bob = nextId("rc_cus");
      const holder = await database.connect();
      try {
        await holder.beginTransaction();
        // The approval's row, which the carry-out takes after it read the customer: it waits there.
        await holder.query("SELECT id FROM api_handoffs WHERE id = ? FOR UPDATE", [approval]);
        const running = rejects(
          create(
            input,
            agent.call({ "idempotency-key": "bound-3", "louez-confirmation": approval }),
          ),
          "APPROVAL_INVALID",
        );
        await waitForLockWaits(holder, database.name, 1);
        // Bob takes the e-mail while it waits, after its read found none.
        await holder.query(
          "INSERT INTO customers (id, store_id, email, first_name, last_name) VALUES (?, ?, ?, 'Bob', 'Other')",
          [bob, STORE, email],
        );
        await holder.commit();
        const refusal = await running;
        assert.equal(refusal.data.details?.reason, "state_changed");
      } finally {
        await holder.end();
      }
      assert.deepEqual(await created(), [], "nothing created, for Bob or anyone");
      assert.equal(
        await handoffStatus(approval),
        "approved",
        "rolled back: the approval was not used",
      );
      const [bobRow] = await louezDb.db
        .select({ firstName: louezDb.customers.firstName })
        .from(louezDb.customers)
        .where(orm.eq(louezDb.customers.id, bob));
      assert.equal(bobRow?.firstName, "Bob", "Bob's details untouched");
    });

    test("a flag with nothing short still asks a person; the refusals answer before anyone is asked", async () => {
      const kayak = await product({ quantity: 5 });
      const agent = await agentKey();
      await rejects(
        create(
          base(kayak, { overrideTurnoverBuffer: true }),
          agent.call({ "idempotency-key": "flag-1" }),
        ),
        "APPROVAL_REQUIRED",
      );
      const full = await product({ quantity: 1 });
      await booking(full, START, END);
      await rejects(
        create(base(full), agent.call({ "idempotency-key": "flag-2" })),
        "RESERVATION_INSUFFICIENT_CAPACITY",
      );
      assert.equal(
        (await louezDb.db.select().from(louezDb.apiHandoffs)).length,
        1,
        "only the first asked",
      );
    });

    test("a read-only key, and a key that cannot write customers for the e-mail form, are refused", async () => {
      const kayak = await product();
      const readOnly = await agentKey({ permissions: { ...everything, reservations: "read" } });
      await rejects(
        create(base(kayak), readOnly.call({ "idempotency-key": "ro-1" })),
        "PERMISSION_DENIED",
      );
      const noCustomers = await agentKey({ permissions: { ...everything, customers: "read" } });
      await rejects(
        create(
          base(kayak, { customer: { email: "x@rc.test", firstName: "X", lastName: "Y" } }),
          noCustomers.call({ "idempotency-key": "nc-1" }),
        ),
        "PERMISSION_DENIED",
      );
      assert.deepEqual(await created(), []);
    });

    // --- Replay -----------------------------------------------------------------------

    test("a key without an idempotency key is refused; the same key replays; another input with it is refused", async () => {
      const kayak = await product({ quantity: 5 });
      const agent = await agentKey({ confirmSensitive: false });
      const refusal = await rejects(create(base(kayak), agent.call()), "IDEMPOTENCY_KEY_REQUIRED");
      assert.deepEqual(refusal.data.details, { header: "Idempotency-Key" });
      assert.deepEqual(await created(), []);

      const input = base(kayak, { notifyCustomer: true });
      const first = await create(input, agent.call({ "idempotency-key": "once-1" }));
      const second = await create(input, agent.call({ "idempotency-key": "once-1" }));
      assert.equal(second.id, first.id);
      assert.equal((await created()).length, 1);
      assert.equal(
        (await outbox()).filter((effect) => effect.type === "reservation.quoteEmail").length,
        1,
        "one message",
      );
      await rejects(
        create(base(kayak, { notifyCustomer: false }), agent.call({ "idempotency-key": "once-1" })),
        "IDEMPOTENCY_KEY_REUSED",
      );
    });

    test("a creation whose answer was lost after its commit is answered from its key, nothing created again", async () => {
      const kayak = await product({ quantity: 5 });
      const agent = await agentKey({ confirmSensitive: false });
      const input = base(kayak, {
        customer: { email: "lost@rc.test", firstName: "Lou", lastName: "Lost" },
        notifyCustomer: true,
      });
      // The record of the answer fails, after the creation committed.
      const connection = await database.connect();
      await connection.query(`CREATE TRIGGER rc_lose_answer BEFORE UPDATE ON api_operations FOR EACH ROW
      BEGIN
        IF NEW.status = 'succeeded' AND NEW.procedure = 'dashboard.reservations.create' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'the answer is lost';
        END IF;
      END`);
      try {
        await rejects(
          create(input, agent.call({ "idempotency-key": "lost-1" })),
          "OPERATION_OUTCOME_UNKNOWN",
        );
      } finally {
        await connection.query("DROP TRIGGER rc_lose_answer");
        await connection.end();
      }
      const [first] = await created();
      assert.ok(first, "the creation committed");

      const context = agent.call({ "idempotency-key": "lost-1" });
      const answer = await create(input, context);
      assert.equal(answer.id, first.id, "the reservation it created");
      assert.equal(context.receipt.replayed, true);
      assert.deepEqual(answer.customer, { id: first.customerId, created: true });
      assert.deepEqual(answer.message, {
        sent: true,
        kind: "quote",
        to: "lost@rc.test",
        reason: null,
      });
      assert.equal((await created()).length, 1, "nothing created again");
      assert.equal(
        (await outbox()).filter((effect) => effect.type === "reservation.quoteEmail").length,
        1,
        "one message",
      );
    });

    // --- The message -------------------------------------------------------------------

    test("notifyCustomer queues the e-mail the status calls for, to the address the preview showed, in the transaction", async () => {
      const kayak = await product({ quantity: 5 });
      const quote = await create(base(kayak, { notifyCustomer: true }), session());
      assert.deepEqual(quote.message, {
        sent: true,
        kind: "quote",
        to: "ada@rc.test",
        reason: null,
      });
      const confirmed = await create(
        base(kayak, { notifyCustomer: true, status: "confirmed" }),
        session(),
      );
      assert.equal(confirmed.message.kind, "confirmation");
      const messages = (await outbox()).filter(
        (effect) => effect.type !== "reservation.createdPlatformNotification",
      );
      assert.deepEqual(messages, [
        {
          type: "reservation.quoteEmail",
          payload: { storeId: STORE, reservationId: quote.id, to: "ada@rc.test" },
        },
        {
          type: "reservation.confirmationEmail",
          payload: { storeId: STORE, reservationId: confirmed.id, to: "ada@rc.test" },
        },
      ]);
      assert.ok(dispatched.length >= 6, "the rows are handed to the dispatch after the commit");
    });

    test("no message is promised when the store turned that e-mail off, or the instance sends none; none on a refusal", async () => {
      const kayak = await product({ quantity: 1 });
      await louezDb.db
        .update(louezDb.stores)
        .set({
          customerNotificationSettings: {
            customer_quote_sent: { enabled: false, email: true, sms: false },
          } as never,
        })
        .where(orm.eq(louezDb.stores.id, STORE));
      const off = await create(base(kayak, { notifyCustomer: true }), session());
      assert.deepEqual(off.message, {
        sent: false,
        kind: null,
        to: null,
        reason: "store_disabled",
      });

      emailConfigured = false;
      const none = await create(
        base(kayak, { notifyCustomer: true, status: "confirmed" }),
        session(),
      );
      assert.equal(none.message.reason, "email_not_configured");
      assert.deepEqual(
        (await outbox()).filter(
          (effect) => effect.type !== "reservation.createdPlatformNotification",
        ),
        [],
      );

      emailConfigured = true;
      const before = (await outbox()).length;
      await rejects(
        create(base(kayak, { notifyCustomer: true, status: "confirmed" }), session()),
        "RESERVATION_INSUFFICIENT_CAPACITY",
      );
      assert.equal((await outbox()).length, before, "a refusal queues nothing");
    });

    test("notifyCustomer for a customer without an e-mail is refused before anything is asked", async () => {
      const kayak = await product();
      await louezDb.db
        .update(louezDb.customers)
        .set({ email: "" })
        .where(orm.eq(louezDb.customers.id, CUSTOMER));
      await rejects(
        create(base(kayak, { notifyCustomer: true }), session()),
        "CUSTOMER_EMAIL_MISSING",
      );
      await create(base(kayak), session());
      assert.equal((await created()).length, 1);
    });
  },
);
