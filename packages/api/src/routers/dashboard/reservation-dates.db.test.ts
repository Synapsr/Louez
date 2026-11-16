import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnLockedRow,
  raceOnOpenTransaction,
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
import {
  NOT_RECORDED,
  recordedPromotion,
  recordedTaxDisplayMode,
  recordedTaxExempt,
} from "../../services/pricing-facts";

process.env.AUTH_SECRET ??= "reservation-dates-test-secret";
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
          return id ? { user: { id, email: `${id}@rd.test` } } : null;
        },
      },
    },
  },
});

// A reservation's dates moved through `reservations.update` (MCP
// `reservations_update`, `POST /reservations/{id}`), on the database: the
// pricing guard, the prices and taxes written, the status and window rules,
// the stock, who is asked, the replay, the races and the customer's message.
// Every expected amount is the pricing engine's own answer for the window
// (`loadPricingCatalog`, `priceCart`, `computeReservationTotals`), never a
// literal copied from the code under test.

const OWNER = "rd_owner_user_000001";
const STORE = "rd_store_a_000000001";
const OTHER_STORE = "rd_store_b_000000001";
const CUSTOMER = "rd_customer_00000001";
const OTHER_CUSTOMER = "rd_customer_00000002";

const START = new Date("2030-06-01T09:00:00.000Z");
const END = new Date("2030-06-03T09:00:00.000Z");
const day = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);
// What the date change wrote for the facts test's input before 0107: no amount changes.
const DATE_CHANGE_MONEY = ["52.50", "63.00", "52.50", "10.50", "20.00"];
const DATE_CHANGE_LINES = [
  ["22.50", "22.50", "20.00", "4.50", "22.50", "22.50"],
  ["30.00", "30.00", "20.00", "6.00", "30.00", "30.00"],
];
const iso = (date: Date) => date.toISOString();

describe(
  "a reservation's dates moved by an agent (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let orpc: typeof import("@orpc/server");
    let orm: typeof import("drizzle-orm");
    let apiKeys: typeof import("../../services/api-keys");
    let catalogs: typeof import("../../services/pricing-catalog");
    let pricing: typeof import("../../services/price-cart");
    let router: typeof import("./reservations").dashboardReservationsRouter;
    let dates: typeof import("../../services/reservation-dates");
    /**
     * Runs once, right before a reservation is read outside any transaction
     * (a read after a commit): the place where another write could land
     * between a change's commit and its answer.
     */
    let beforeReadAfterCommit: (() => Promise<unknown>) | null = null;
    let handoffsRouter: typeof import("./handoffs").dashboardHandoffsRouter;

    const events: ApiEvent[] = [];
    const dispatched: string[] = [];
    let emailConfigured = true;
    const ports = {
      planFeatures: async () => ({ apiAccess: true }),
      storage: createMemoryStorage(),
      urls: createTestUrls(),
      afterCommit: (event: ApiEvent) => {
        events.push(event);
      },
      runReservationEffects: async () => {},
      insurance: {
        createContract: async () => {
          throw new Error("a date change never calls the insurer");
        },
        cancelContract: async () => {
          throw new Error("a date change never calls the insurer");
        },
      },
      newStores: createTestNewStores(),
      dispatchEffects: (ids: readonly string[]) => {
        dispatched.push(...ids);
      },
      emailConfigured: () => emailConfigured,
    };

    const baseSettings = {
      reservationMode: "request" as const,
      currency: "EUR",
      pendingBlocksAvailability: true,
      advanceNoticeMinutes: 0,
      minRentalMinutes: 0,
      turnoverBufferMinutes: 0,
    };
    const TTC = { enabled: true, defaultRate: 20, displayMode: "inclusive" as const };
    const HT = { enabled: true, defaultRate: 20, displayMode: "exclusive" as const };

    before(async () => {
      database = await createTestDatabase("api_reservation_dates");
      louezDb = await import("@louez/db");
      orpc = await import("@orpc/server");
      orm = await import("drizzle-orm");
      apiKeys = await import("../../services/api-keys");
      catalogs = await import("../../services/pricing-catalog");
      pricing = await import("../../services/price-cart");
      // `getReservation`, watched: a read with no transaction runs the hook first.
      const reservationsService: Record<string, unknown> =
        await import("../../services/reservations");
      const read = reservationsService.getReservation as (...args: unknown[]) => Promise<unknown>;
      mock.module(import.meta.resolve("../../services/reservations"), {
        namedExports: {
          ...reservationsService,
          getReservation: async (...args: unknown[]) => {
            if (args[2] === undefined && beforeReadAfterCommit) {
              const hook = beforeReadAfterCommit;
              beforeReadAfterCommit = null;
              await hook();
            }
            return read(...args);
          },
        },
      });
      ({ dashboardReservationsRouter: router } = await import("./reservations"));
      dates = await import("../../services/reservation-dates");
      ({ dashboardHandoffsRouter: handoffsRouter } = await import("./handoffs"));

      await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@rd.test" });
      await louezDb.db.insert(louezDb.stores).values([
        { id: STORE, userId: OWNER, name: "A store", slug: "rd-store-a", settings: baseSettings },
        { id: OTHER_STORE, userId: OWNER, name: "B", slug: "rd-store-b", settings: baseSettings },
      ]);
      await louezDb.db.insert(louezDb.storeMembers).values([
        { storeId: STORE, userId: OWNER, role: "owner" },
        { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
      ]);
      await louezDb.db.insert(louezDb.customers).values([
        {
          id: CUSTOMER,
          storeId: STORE,
          email: "ada@rd.test",
          firstName: "Ada",
          lastName: "Lovelace",
        },
        {
          id: OTHER_CUSTOMER,
          storeId: OTHER_STORE,
          email: "grace@rd.test",
          firstName: "Grace",
          lastName: "Hopper",
        },
      ]);
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      events.length = 0;
      dispatched.length = 0;
      emailConfigured = true;
      for (const table of [
        louezDb.apiEffects,
        louezDb.apiOperations,
        louezDb.apiConfirmations,
        louezDb.apiHandoffs,
        louezDb.payments,
        louezDb.reservationActivity,
        louezDb.reservationItemUnits,
        louezDb.reservationItems,
        louezDb.reservations,
        louezDb.productUnits,
        louezDb.products,
      ]) {
        await louezDb.db.delete(table);
      }
      await setSettings({});
      await louezDb.db
        .update(louezDb.customers)
        .set({ email: "ada@rd.test" })
        .where(orm.eq(louezDb.customers.id, CUSTOMER));
    });

    async function setSettings(extra: Record<string, unknown>) {
      await louezDb.db
        .update(louezDb.stores)
        .set({ settings: { ...baseSettings, ...extra } as never })
        .where(orm.eq(louezDb.stores.id, STORE));
    }

    // --- Callers --------------------------------------------------------------

    function session() {
      return {
        headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${STORE}` }),
        transport: "rpc" as const,
        ports,
        receipt: {} as { operationId?: string; replayed?: boolean },
      };
    }

    type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
    const everything: Permissions = {
      reservations: "write",
      products: "read",
      customers: "read",
      categories: "read",
      payments: "read",
      analytics: "read",
      settings: "read",
    };

    /** An API key, its confirmations on (the default) or off. */
    async function agentKey(
      options: { confirmSensitive?: boolean; permissions?: Permissions } = {},
    ) {
      const created = await apiKeys.createApiKey({
        db: louezDb.db,
        storeId: STORE,
        userId: OWNER,
        name: "Dates agent",
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
    type UpdateInput = Parameters<Client["update"]>[0];

    function update(input: UpdateInput, context: BaseContext) {
      const client = orpc.createRouterClient(router, {
        context,
        path: ["dashboard", "reservations"],
      }) as Client;
      return client.update(input);
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
    type Preview = {
      summary: string;
      details: {
        reservation: { previousTotal: string; total: string; difference: string; currency: string };
        lines: Array<{ previousTotal: string; total: string }>;
        overbooking: { shortfalls: Array<{ requested: number; available: number }> } | null;
        turnoverBuffer: { shortfalls: unknown[]; turnoverBufferMinutes: number } | null;
        messages: Array<{ message: string; channel: string; to?: string }>;
        warnings: Array<{ key: string }>;
      };
    };
    const previewOf = (refusal: { data: { details?: Record<string, unknown> } }) =>
      (refusal.data.details as { preview: Preview }).preview;

    /** The owner approves the request on its page, the box ticked: the approval's id. */
    async function approvedOf(refusal: { data: { details?: Record<string, unknown> } }) {
      const id = String((refusal.data.details?.approval as { id?: string } | undefined)?.id);
      assert.equal(tokenOf(refusal), id, "the id is what the call takes back");
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

    // --- Fixtures: products, and bookings priced by the engine ----------------

    let counter = 0;
    const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(12, "0")}`;

    async function product(
      options: {
        quantity?: number;
        price?: string;
        stockKind?: "returnable" | "consumable";
        trackUnits?: boolean;
        taxSettings?: { inheritFromStore: boolean; customRate?: number };
        promotion?: { percentage: number; startsOn: string | null; endsOn: string | null };
      } = {},
    ) {
      const id = nextId("rd_prd");
      await louezDb.db.insert(louezDb.products).values({
        id,
        storeId: STORE,
        name: `Kayak ${id}`,
        price: options.price ?? "10.00",
        pricingMode: "day",
        stockKind: options.stockKind ?? "returnable",
        quantity: options.quantity ?? 1,
        trackUnits: options.trackUnits ?? false,
        taxSettings: options.taxSettings ?? null,
        promotion: options.promotion ?? null,
      });
      return id;
    }

    async function unit(productId: string, identifier: string) {
      const id = nextId("rd_unt");
      await louezDb.db.insert(louezDb.productUnits).values({ id, productId, identifier });
      return id;
    }

    /** The store's settings, as the engine reads them. */
    async function storeSettings() {
      const [row] = await louezDb.db
        .select({ settings: louezDb.stores.settings })
        .from(louezDb.stores)
        .where(orm.eq(louezDb.stores.id, STORE));
      return row?.settings ?? null;
    }

    /** What the checkout's engine gives for these lines over a window. */
    async function engine(
      lines: ReadonlyArray<{ productId: string; quantity: number }>,
      window: { start: Date; end: Date },
      now = new Date(),
    ) {
      const settings = await storeSettings();
      const catalog = await catalogs.loadPricingCatalog(louezDb.db, {
        storeId: STORE,
        productIds: lines.map((line) => line.productId),
        timezone: settings?.timezone,
      });
      const priced = pricing.priceCart({
        catalog,
        now,
        lines: lines.map((line) => ({
          ...line,
          startDate: iso(window.start),
          endDate: iso(window.end),
        })),
      });
      assert.ok(priced.ok, "the engine prices the lines");
      const totals = pricing.computeReservationTotals({
        lines: priced.cart.lines,
        insuranceAmount: 0,
        discountAmount: 0,
        deliveryFee: 0,
        totalDeposit: 50,
        taxSettings: settings?.tax,
      });
      return {
        lines: priced.cart.lines.map((line, index) => ({
          unitPrice: line.unitPrice.toFixed(2),
          totalPrice: line.subtotal.toFixed(2),
          promotion: line.promotion ?? null,
          ...Object.fromEntries(
            Object.entries(pricing.getReservationItemTaxFields(totals, line, index)).map(
              ([key, value]) => [key, value === null ? null : value.toFixed(2)],
            ),
          ),
        })),
        subtotalAmount: totals.subtotal.toFixed(2),
        totalAmount: totals.total.toFixed(2),
        taxAmount: totals.taxAmount?.toFixed(2) ?? null,
        subtotalExclTax: totals.subtotalExclTax?.toFixed(2) ?? null,
        taxRate: totals.taxRate?.toFixed(2) ?? null,
      };
    }

    type Line = { productId: string; quantity?: number; unitId?: string; combinationKey?: string };

    /**
     * A reservation booked as the checkout books it: each line, and the
     * totals, written from the engine over its window (`now` for a promotion's
     * day). `edit` overrides a column, for a fact stored otherwise.
     */
    async function book(
      lines: Line[],
      options: {
        status?:
          | "pending"
          | "quote"
          | "confirmed"
          | "ongoing"
          | "completed"
          | "cancelled"
          | "rejected"
          | "declined";
        start?: Date;
        end?: Date;
        currency?: string | null;
        now?: Date;
        store?: string;
        edit?: Record<string, unknown>;
        lineEdit?: Record<string, unknown>;
      } = {},
    ) {
      const start = options.start ?? START;
      const end = options.end ?? END;
      const store = options.store ?? STORE;
      const priced = await engine(
        lines.map((line) => ({ productId: line.productId, quantity: line.quantity ?? 1 })),
        { start, end },
        options.now,
      );
      const id = nextId("rd_res");
      // A fixture, so it may start in any status.
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: store,
        customerId: store === STORE ? CUSTOMER : OTHER_CUSTOMER,
        number: id,
        status: options.status ?? "confirmed",
        startDate: start,
        endDate: end,
        subtotalAmount: priced.subtotalAmount,
        depositAmount: "50.00",
        totalAmount: priced.totalAmount,
        taxAmount: priced.taxAmount,
        subtotalExclTax: priced.subtotalExclTax,
        taxRate: priced.taxRate,
        currency: options.currency === undefined ? "EUR" : options.currency,
        source: "online",
        ...options.edit,
      });
      const items: string[] = [];
      for (const [index, line] of lines.entries()) {
        const price = priced.lines[index]!;
        const itemId = nextId("rd_itm");
        items.push(itemId);
        await louezDb.db.insert(louezDb.reservationItems).values({
          id: itemId,
          reservationId: id,
          productId: line.productId,
          quantity: line.quantity ?? 1,
          unitPrice: price.unitPrice,
          depositPerUnit: "50.00",
          totalPrice: price.totalPrice,
          taxRate: price.taxRate as string | null,
          taxAmount: price.taxAmount as string | null,
          priceExclTax: price.priceExclTax as string | null,
          totalExclTax: price.totalExclTax as string | null,
          combinationKey: line.combinationKey ?? null,
          productSnapshot: { name: "Kayak", description: null, images: [] },
          // A fixed creation order: the lines are read and priced in it.
          createdAt: new Date(START.getTime() - 60_000 + index * 1000),
          ...(price.promotion
            ? {
                pricingBreakdown: {
                  basePrice: 10,
                  effectivePrice: Number(price.unitPrice),
                  duration: 2,
                  pricingMode: "day" as const,
                  discountPercent: price.promotion.percentage,
                  discountAmount: price.promotion.discountAmount,
                  tierApplied: null,
                  promotion: price.promotion,
                  taxRate: null,
                  taxAmount: null,
                  subtotalExclTax: null,
                  subtotalInclTax: null,
                },
              }
            : {}),
          ...options.lineEdit,
        });
        if (line.unitId) {
          await louezDb.db.insert(louezDb.reservationItemUnits).values({
            id: nextId("rd_asg"),
            reservationItemId: itemId,
            productUnitId: line.unitId,
            identifierSnapshot: line.unitId,
          });
        }
      }
      return { id, items };
    }

    async function reservationRow(id: string) {
      const [row] = await louezDb.db
        .select()
        .from(louezDb.reservations)
        .where(orm.eq(louezDb.reservations.id, id));
      assert.ok(row, id);
      return row;
    }

    async function itemRows(id: string) {
      return louezDb.db
        .select()
        .from(louezDb.reservationItems)
        .where(orm.eq(louezDb.reservationItems.reservationId, id))
        .orderBy(louezDb.reservationItems.createdAt);
    }

    async function activityOf(id: string) {
      return louezDb.db
        .select()
        .from(louezDb.reservationActivity)
        .where(orm.eq(louezDb.reservationActivity.reservationId, id));
    }

    /** The date changes' own activity rows: the contract's validation writes another `modified` row. */
    async function changeRows(id: string) {
      return (await activityOf(id)).filter(
        (entry) =>
          entry.activityType === "modified" &&
          typeof entry.metadata === "object" &&
          entry.metadata !== null &&
          "previous" in entry.metadata,
      );
    }
    const changeMetadata = async (id: string) =>
      (await changeRows(id))[0]?.metadata as Record<string, unknown> | undefined;

    async function outbox() {
      return louezDb.db
        .select({ type: louezDb.apiEffects.type, payload: louezDb.apiEffects.payload })
        .from(louezDb.apiEffects)
        .orderBy(louezDb.apiEffects.seq);
    }

    /** Nothing of the reservation changed: its row, its lines, its history, the outbox. */
    async function unchanged(id: string, before: Awaited<ReturnType<typeof snapshot>>) {
      assert.deepEqual(await snapshot(id), before, "nothing was written");
    }
    async function snapshot(id: string) {
      return {
        reservation: await reservationRow(id),
        items: await itemRows(id),
        activity: (await activityOf(id)).length,
        outbox: (await outbox()).length,
      };
    }

    /** The stored reservation equals the engine's answer over its window. */
    async function assertPricedByEngine(
      id: string,
      lines: Line[],
      window: { start: Date; end: Date },
    ) {
      const expected = await engine(
        lines.map((line) => ({ productId: line.productId, quantity: line.quantity ?? 1 })),
        window,
      );
      const row = await reservationRow(id);
      assert.equal(row.subtotalAmount, expected.subtotalAmount, "subtotal");
      assert.equal(row.totalAmount, expected.totalAmount, "total");
      assert.equal(row.taxAmount, expected.taxAmount, "tax");
      assert.equal(row.subtotalExclTax, expected.subtotalExclTax, "subtotal before tax");
      assert.equal(row.taxRate, expected.taxRate, "tax rate");
      assert.equal(row.depositAmount, "50.00", "the deposit stays as stored");
      const items = await itemRows(id);
      for (const [index, line] of expected.lines.entries()) {
        const item = items[index]!;
        assert.equal(item.totalPrice, line.totalPrice, `line ${index} total`);
        assert.equal(item.unitPrice, line.unitPrice, `line ${index} unit price`);
        assert.equal(item.taxRate, line.taxRate, `line ${index} tax rate`);
        assert.equal(item.taxAmount, line.taxAmount, `line ${index} tax`);
        assert.equal(item.priceExclTax, line.priceExclTax, `line ${index} unit price before tax`);
        assert.equal(item.totalExclTax, line.totalExclTax, `line ${index} total before tax`);
      }
      return expected;
    }

    const move = (id: string, end: Date, extra: Partial<UpdateInput> = {}): UpdateInput => ({
      id,
      endDate: iso(end),
      notifyCustomer: false,
      ...extra,
    });

    // --- Money -----------------------------------------------------------------

    describe("the price", () => {
      test("prices with tax: the new window's prices and tax figures are the engine's, the deposit kept", async () => {
        await setSettings({ tax: TTC });
        const kayak = await product({ quantity: 3 });
        const lines = [{ productId: kayak, quantity: 2 }];
        const { id } = await book(lines);
        const before = await reservationRow(id);

        const answer = await update(move(id, day(END, 1)), session());

        const expected = await assertPricedByEngine(id, lines, { start: START, end: day(END, 1) });
        assert.equal(answer.changed, true);
        assert.equal(answer.previousTotal, before.totalAmount);
        assert.equal(answer.currency, "EUR");
        assert.equal(
          answer.difference,
          (
            (Math.round(Number(expected.totalAmount) * 100) -
              Math.round(Number(before.totalAmount) * 100)) /
            100
          ).toFixed(2),
        );
        assert.equal(answer.endDate.toISOString(), iso(day(END, 1)));
        assert.equal(answer.previousEndDate.toISOString(), iso(END));
        assert.ok(answer.links.dashboard.includes(id));
        const row = await reservationRow(id);
        assert.ok(row.scheduleChangedAt, "the inbox dates a late return from the change");
      });

      test("prices before tax, with an exempt line: the tax comes on top, the exempt line has none", async () => {
        await setSettings({ tax: HT });
        const taxed = await product({ quantity: 3 });
        const exempt = await product({
          quantity: 3,
          taxSettings: { inheritFromStore: false, customRate: 0 },
        });
        const lines = [{ productId: taxed }, { productId: exempt }];
        const { id } = await book(lines);

        await update(move(id, day(END, 2)), session());

        const expected = await assertPricedByEngine(id, lines, { start: START, end: day(END, 2) });
        assert.equal(expected.lines[1]?.taxAmount, "0.00", "the exempt line carries no tax");
        assert.ok(Number(expected.totalAmount) > Number(expected.subtotalAmount), "the tax on top");
      });

      test("a product promotion that still applies is kept, and the total is the engine's", async () => {
        const promoted = await product({
          quantity: 3,
          promotion: { percentage: 25, startsOn: null, endsOn: null },
        });
        const lines = [{ productId: promoted }];
        const { id } = await book(lines);

        await update(move(id, day(END, 1)), session());

        const expected = await assertPricedByEngine(id, lines, { start: START, end: day(END, 1) });
        const [item] = await itemRows(id);
        assert.ok(expected.lines[0]?.promotion, "the engine applies it");
        assert.deepEqual(item?.pricingBreakdown?.promotion, expected.lines[0]?.promotion);
      });

      test("the facts it was priced with are carried through (slice 9); no amount changes", async () => {
        await setSettings({ tax: HT });
        const promoted = await product({
          quantity: 3,
          promotion: { percentage: 25, startsOn: null, endsOn: null },
        });
        const plain = await product({ quantity: 3 });
        const lines = [{ productId: promoted }, { productId: plain }];
        const { id, items } = await book(lines, {
          edit: { taxDisplayMode: "exclusive" },
          lineEdit: { taxExempt: false },
        });
        // The plain line records that no promotion applied, as the checkout writes it now.
        await louezDb.db
          .update(louezDb.reservationItems)
          .set({
            pricingBreakdown: {
              basePrice: 10,
              effectivePrice: 20,
              duration: 2,
              pricingMode: "day",
              discountPercent: null,
              discountAmount: 0,
              tierApplied: null,
              promotion: null,
              taxRate: null,
              taxAmount: null,
              subtotalExclTax: null,
              subtotalInclTax: null,
            },
          })
          .where(orm.eq(louezDb.reservationItems.id, items[1]!));

        await update(move(id, day(END, 1)), session());

        const row = await reservationRow(id);
        const written = await itemRows(id);
        // The money, as the change wrote it before the facts were recorded.
        assert.deepEqual(
          [row.subtotalAmount, row.totalAmount, row.subtotalExclTax, row.taxAmount, row.taxRate],
          DATE_CHANGE_MONEY,
        );
        assert.deepEqual(
          written.map((item) => [
            item.unitPrice,
            item.totalPrice,
            item.taxRate,
            item.taxAmount,
            item.priceExclTax,
            item.totalExclTax,
          ]),
          DATE_CHANGE_LINES,
        );
        // The facts: kept as recorded; the promotion recorded, as the new price applied it.
        assert.equal(recordedTaxDisplayMode(row), "exclusive");
        assert.deepEqual(written.map(recordedTaxExempt), [false, false]);
        const [kept, none] = written.map(recordedPromotion);
        assert.ok(kept !== NOT_RECORDED && kept?.percentage === 25, JSON.stringify(kept));
        assert.equal(none, null, "a line that recorded no promotion still records none");
      });

      test("the mode it records is the one its amounts were computed with", async () => {
        // Booked before tax; the store now shows prices with tax. A line at 0 %
        // costs the same in both modes, so the guard reproduces it.
        await setSettings({ tax: TTC });
        const zeroRated = await product({
          quantity: 3,
          taxSettings: { inheritFromStore: false, customRate: 0 },
        });
        const lines = [{ productId: zeroRated }];
        const { id } = await book(lines, {
          edit: { taxDisplayMode: "exclusive" },
          lineEdit: { taxExempt: false },
        });

        await update(move(id, day(END, 1)), session());

        await assertPricedByEngine(id, lines, { start: START, end: day(END, 1) });
        assert.equal(recordedTaxDisplayMode(await reservationRow(id)), "inclusive");
        assert.deepEqual((await itemRows(id)).map(recordedTaxExempt), [false]);
      });

      test("a promotion that ended since the booking is refused, nothing written", async () => {
        const promoted = await product({
          quantity: 3,
          promotion: { percentage: 25, startsOn: "2020-01-01", endsOn: "2020-12-31" },
        });
        // Booked while it applied.
        const { id } = await book([{ productId: promoted }], {
          now: new Date("2020-06-01T10:00:00Z"),
        });
        const before = await snapshot(id);

        const refused = await rejects(
          update(move(id, day(END, 1)), session()),
          "RESERVATION_EDIT_IN_DASHBOARD",
        );

        assert.equal(refused.data.details?.reason, "prices_not_reproducible");
        await unchanged(id, before);
      });

      test("tax settings changed since the booking are refused", async () => {
        const kayak = await product({ quantity: 3 });
        const { id } = await book([{ productId: kayak }]);
        await setSettings({ tax: TTC });
        const before = await snapshot(id);

        const refused = await rejects(
          update(move(id, day(END, 1)), session()),
          "RESERVATION_EDIT_IN_DASHBOARD",
        );

        assert.equal(refused.data.details?.reason, "prices_not_reproducible");
        await unchanged(id, before);
      });

      test("a price typed by hand is refused, flagged or not", async () => {
        const kayak = await product({ quantity: 3 });
        const flagged = await book([{ productId: kayak }], {
          lineEdit: {
            pricingBreakdown: {
              basePrice: 10,
              effectivePrice: 5,
              duration: 2,
              pricingMode: "day",
              discountPercent: null,
              discountAmount: 0,
              tierApplied: null,
              taxRate: null,
              taxAmount: null,
              subtotalExclTax: null,
              subtotalInclTax: null,
              isManualOverride: true,
            },
          },
        });
        const typed = await book([{ productId: kayak }], {
          lineEdit: { totalPrice: "15.00", unitPrice: "15.00" },
          edit: { subtotalAmount: "15.00", totalAmount: "15.00" },
        });

        const first = await rejects(
          update(move(flagged.id, day(END, 1)), session()),
          "RESERVATION_EDIT_IN_DASHBOARD",
        );
        assert.equal(first.data.details?.reason, "custom_or_manual_lines");
        const second = await rejects(
          update(move(typed.id, day(END, 1)), session()),
          "RESERVATION_EDIT_IN_DASHBOARD",
        );
        assert.equal(second.data.details?.reason, "prices_not_reproducible");
      });

      test("a reservation in another currency than the store's states its own", async () => {
        await setSettings({ tax: TTC });
        const kayak = await product({ quantity: 3 });
        const lines = [{ productId: kayak }];
        const { id } = await book(lines, { currency: "USD" });
        const agent = await agentKey();

        const asked = await rejects(
          update(move(id, day(END, 1)), agent.call()),
          "CONFIRMATION_REQUIRED",
        );
        assert.equal(previewOf(asked).details.reservation.currency, "USD");
        assert.match(previewOf(asked).summary, /USD/);
        const answer = await update(
          move(id, day(END, 1)),
          agent.call({ "louez-confirmation": tokenOf(asked) }),
        );

        assert.equal(answer.currency, "USD");
        await assertPricedByEngine(id, lines, { start: START, end: day(END, 1) });
        assert.equal((await changeMetadata(id))?.currency, "USD");
      });

      test("each stored fact the change cannot derive again sends it to the dashboard", async () => {
        const kayak = await product({ quantity: 9 });
        const cases: Array<[string, Parameters<typeof book>[1]]> = [
          ["insured", { edit: { tulipInsuranceOptIn: true } }],
          ["discount_or_promo_code", { edit: { discountAmount: "5.00" } }],
          ["marketplace", { edit: { source: "marketplace" } }],
          ["delivery", { edit: { returnMethod: "address" } }],
          ["booking_facts_missing", { currency: null }],
        ];
        for (const [reason, options] of cases) {
          const { id } = await book([{ productId: kayak }], options);
          const before = await snapshot(id);
          const refused = await rejects(
            update(move(id, day(END, 1)), session()),
            "RESERVATION_EDIT_IN_DASHBOARD",
          );
          assert.equal(refused.data.details?.reason, reason);
          await unchanged(id, before);
        }

        // A product no longer active.
        const gone = await product({ quantity: 3 });
        const onGone = await book([{ productId: gone }]);
        await louezDb.db
          .update(louezDb.products)
          .set({ status: "archived" })
          .where(orm.eq(louezDb.products.id, gone));
        const archived = await rejects(
          update(move(onGone.id, day(END, 1)), session()),
          "RESERVATION_EDIT_IN_DASHBOARD",
        );
        assert.equal(archived.data.details?.reason, "product_unavailable");

        // The customer's extension checkout is open.
        const extended = await book([{ productId: kayak }]);
        await louezDb.db.insert(louezDb.reservationActivity).values({
          id: nextId("rd_act"),
          reservationId: extended.id,
          activityType: "modified",
          metadata: {
            kind: "rental_extension",
            status: "checkout",
            expiresMs: Date.now() + 600_000,
          },
        });
        const open = await rejects(
          update(move(extended.id, day(END, 1)), session()),
          "RESERVATION_EDIT_IN_DASHBOARD",
        );
        assert.equal(open.data.details?.reason, "extension_checkout_open");
      });
    });

    // --- Status and window --------------------------------------------------------

    describe("the instants", () => {
      /** A refusal by the contract or the service: nothing written either way. */
      async function refusedSubSecond(id: string, input: UpdateInput) {
        const before = await snapshot(id);
        let caught: unknown;
        try {
          await update(input, session());
        } catch (error) {
          caught = error;
        }
        assert.ok(caught, `${JSON.stringify(input)} was accepted`);
        await unchanged(id, before);
      }

      test("an end a millisecond, or 999, past a whole second is refused before anything is priced", async () => {
        const kayak = await product({ quantity: 9 });
        // One day at 10.00: a millisecond more is no second day.
        const { id } = await book([{ productId: kayak }], { end: day(START, 1) });
        for (const extra of [1, 999]) {
          const end = new Date(day(START, 1).getTime() + extra);
          await refusedSubSecond(id, move(id, end));
        }
      });

      test("a fraction finer than a millisecond is refused; a zero fraction is a whole second", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }], { end: day(START, 1) });
        await refusedSubSecond(id, {
          id,
          endDate: "2030-06-02T11:00:00.0001+02:00",
          notifyCustomer: false,
        });
        const answer = await update(
          { id, endDate: "2030-06-03T11:00:00.000+02:00", notifyCustomer: false },
          session(),
        );
        assert.equal(answer.changed, true);
        assert.equal(answer.endDate.toISOString(), "2030-06-03T09:00:00.000Z");
      });

      test("an ongoing reservation's start cannot pass as unmoved by a fraction of a second", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }], { status: "ongoing" });
        await refusedSubSecond(id, {
          id,
          startDate: iso(new Date(START.getTime() + 1)),
          endDate: iso(day(END, 1)),
          notifyCustomer: false,
        });
      });

      test("the service refuses a fraction of a second itself, for a caller that skips the contract", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        const before = await snapshot(id);
        await assert.rejects(
          dates.changeReservationDates(
            {
              storeId: STORE,
              userId: OWNER,
              credential: { kind: "session", id: null },
              transport: "rpc",
              customers: true,
              reader: { storeId: STORE, currency: "EUR", customers: true, payments: true },
              store: { id: STORE, name: "A store", slug: "rd-store-a", ownerUserId: OWNER },
              ports,
            },
            { id, endDate: new Date(day(END, 1).getTime() + 1), notifyCustomer: false },
          ),
          (error: { data?: { code?: string; details?: { reason?: string } } }) =>
            error.data?.code === "RESERVATION_WINDOW_INVALID" &&
            error.data.details?.reason === "not_whole_seconds",
        );
        await unchanged(id, before);
      });

      test("the stored instant written in another offset is the same dates: changed false", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        const before = await snapshot(id);
        // 09:00Z is 11:00 at +02:00.
        const answer = await update(
          { id, endDate: "2030-06-03T11:00:00+02:00", notifyCustomer: false },
          session(),
        );
        assert.equal(answer.changed, false);
        await unchanged(id, before);
      });

      test("the dates stored are the dates priced and answered", async () => {
        const kayak = await product({ quantity: 9 });
        const lines = [{ productId: kayak }];
        const { id } = await book(lines);
        const answer = await update(
          { id, endDate: "2030-06-04T11:30:00+02:00", notifyCustomer: false },
          session(),
        );
        const row = await reservationRow(id);
        assert.equal(row.endDate.getTime(), answer.endDate.getTime());
        assert.equal(row.endDate.toISOString(), "2030-06-04T09:30:00.000Z");
        // Priced on what is stored: the engine over the stored window gives the stored totals.
        await assertPricedByEngine(id, lines, { start: row.startDate, end: row.endDate });
        const updated = (await changeMetadata(id))?.updated as { endDate?: string } | undefined;
        assert.equal(updated?.endDate, row.endDate.toISOString());
      });
    });

    describe("the status and the window", () => {
      test("a completed, cancelled, rejected or declined reservation is not edited", async () => {
        const kayak = await product({ quantity: 9 });
        for (const status of ["completed", "cancelled", "rejected", "declined"] as const) {
          const { id } = await book([{ productId: kayak }], { status });
          const before = await snapshot(id);
          const refused = await rejects(
            update(move(id, day(END, 1)), session()),
            "RESERVATION_NOT_EDITABLE",
          );
          assert.equal(refused.data.details?.status, status);
          await unchanged(id, before);
        }
      });

      test("a completion or a cancellation landing while the change waits is refused under the lock", async () => {
        const kayak = await product({ quantity: 9 });
        for (const status of ["completed", "cancelled"] as const) {
          const { id } = await book([{ productId: kayak }], { status: "ongoing" });
          const [result] = await raceOnOpenTransaction(
            database,
            async (holder) => {
              await holder.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE", [id]);
              await holder.query("UPDATE reservations SET reservation_status = ? WHERE id = ?", [
                status,
                id,
              ]);
            },
            [
              () =>
                update(move(id, day(END, 1)), session()).then(
                  () => "changed",
                  (error) => error,
                ),
            ],
          );
          assert.equal(
            (result as { data?: { code?: string } }).data?.code,
            "RESERVATION_NOT_EDITABLE",
          );
          assert.equal((await reservationRow(id)).endDate.toISOString(), iso(END));
        }
      });

      test("a window of no length, or inverted, is refused", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        for (const end of [START, day(START, -1)]) {
          const refused = await rejects(
            update(move(id, end), session()),
            "RESERVATION_WINDOW_INVALID",
          );
          assert.equal(refused.data.details?.reason, "end_not_after_start");
        }
      });

      test("an ongoing reservation's start cannot move; its end can", async () => {
        const kayak = await product({ quantity: 9 });
        const lines = [{ productId: kayak }];
        const { id } = await book(lines, { status: "ongoing" });

        const refused = await rejects(
          update({ id, startDate: iso(day(START, -1)), notifyCustomer: false }, session()),
          "RESERVATION_WINDOW_INVALID",
        );
        assert.equal(refused.data.details?.reason, "ongoing_start_moved");

        const answer = await update(move(id, day(END, 1)), session());
        assert.equal(answer.changed, true);
        await assertPricedByEngine(id, lines, { start: START, end: day(END, 1) });
      });

      test("an unknown field is refused, and at least one date is required", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        await rejects(
          update({ ...move(id, day(END, 1)), lines: [] } as unknown as UpdateInput, session()),
          "BAD_REQUEST",
        );
        await rejects(
          update({ id, notifyCustomer: false } as UpdateInput, session()),
          "BAD_REQUEST",
        );
        await rejects(
          update({ id, endDate: "2030-06-04T09:00:00", notifyCustomer: false }, session()),
          "BAD_REQUEST",
        );
      });
    });

    // --- Stock -------------------------------------------------------------------

    describe("the stock", () => {
      /** One kayak, booked by another reservation the day after ours. */
      async function fullNextDay() {
        const kayak = await product({ quantity: 1 });
        const ours = await book([{ productId: kayak }]);
        await book([{ productId: kayak }], { start: day(END, 1), end: day(END, 2) });
        return { kayak, ...ours };
      }

      test("extended into a full day: refused with its shortfalls; with allowOverbooking, moved and traced", async () => {
        const { id } = await fullNextDay();
        const before = await snapshot(id);

        const refused = await rejects(
          update(move(id, day(END, 2)), session()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );
        const shortfalls = refused.data.details?.shortfalls as Array<{
          requested: number;
          available: number;
        }>;
        assert.deepEqual(
          shortfalls.map(({ requested, available }) => ({ requested, available })),
          [{ requested: 1, available: 0 }],
        );
        await unchanged(id, before);

        const answer = await update(move(id, day(END, 2), { allowOverbooking: true }), session());
        assert.equal(answer.capacity.overbooked, true);
        const metadata = (await changeMetadata(id)) as Record<string, unknown>;
        assert.equal(metadata.overbooked, true);
        assert.deepEqual(metadata.credential, { kind: "session", id: null });
      });

      test("a conflict only the turnover buffer makes needs overrideTurnoverBuffer, not allowOverbooking", async () => {
        await setSettings({ turnoverBufferMinutes: 120 });
        const kayak = await product({ quantity: 1 });
        const { id } = await book([{ productId: kayak }]);
        // The next rental starts an hour after the new end: inside the two-hour buffer.
        const newEnd = day(END, 1);
        await book([{ productId: kayak }], {
          start: new Date(newEnd.getTime() + 3_600_000),
          end: day(newEnd, 2),
        });

        await rejects(update(move(id, newEnd), session()), "RESERVATION_TURNOVER_BUFFER_CONFLICT");
        await rejects(
          update(move(id, newEnd, { allowOverbooking: true }), session()),
          "RESERVATION_TURNOVER_BUFFER_CONFLICT",
        );
        const answer = await update(move(id, newEnd, { overrideTurnoverBuffer: true }), session());
        assert.equal(answer.capacity.overbooked, false, "nothing short without the buffer");
        const metadata = (await changeMetadata(id)) as Record<string, unknown>;
        assert.equal(metadata.turnoverBufferOverridden, true);
        assert.equal(metadata.turnoverBufferMinutes, 120);
        assert.equal(metadata.overbooked, false);
      });

      test("a window inside the stored one is never refused for the stock", async () => {
        const kayak = await product({ quantity: 1 });
        const ours = await book([{ productId: kayak }], { end: day(END, 2) });
        // Another booking over the same days: the stock is short already.
        await book([{ productId: kayak }], { end: day(END, 2) });

        const answer = await update(move(ours.id, END), session());

        assert.equal(answer.changed, true);
        assert.equal(answer.capacity.overbooked, true, "the verdict still records what is short");
      });

      test("a unit the reservation holds that another booking holds over the new dates refuses, whatever the flags", async () => {
        const bike = await product({ quantity: 2, trackUnits: true });
        const first = await unit(bike, "B-1");
        await unit(bike, "B-2");
        const ours = await book([{ productId: bike, unitId: first }]);
        await book([{ productId: bike, unitId: first }], { start: day(END, 1), end: day(END, 2) });
        const before = await snapshot(ours.id);

        const refused = await rejects(
          update(
            move(ours.id, day(END, 2), { allowOverbooking: true, overrideTurnoverBuffer: true }),
            session(),
          ),
          "RESERVATION_UNITS_UNAVAILABLE",
        );
        assert.deepEqual(
          (refused.data.details?.conflicts as Array<{ unitId: string }> | undefined)?.map(
            (conflict) => conflict.unitId,
          ),
          [first],
        );
        await unchanged(ours.id, before);
      });

      test("a consumable line moves with its dates; its stock is unchanged", async () => {
        const gas = await product({ quantity: 5, stockKind: "consumable" });
        const lines = [{ productId: gas, quantity: 2 }];
        // Confirmed: its two units were taken when it was confirmed.
        const { id } = await book(lines, { lineEdit: { consumedQuantity: 2 } });
        const [stockBefore] = await louezDb.db
          .select({ quantity: louezDb.products.quantity })
          .from(louezDb.products)
          .where(orm.eq(louezDb.products.id, gas));

        await update(move(id, day(END, 1)), session());

        await assertPricedByEngine(id, lines, { start: START, end: day(END, 1) });
        const [stockAfter] = await louezDb.db
          .select({ quantity: louezDb.products.quantity })
          .from(louezDb.products)
          .where(orm.eq(louezDb.products.id, gas));
        assert.deepEqual(stockAfter, stockBefore);
      });
    });

    // --- Who is asked ------------------------------------------------------------------

    describe("who is asked", () => {
      test("a session is never asked; a key is asked per its option for the change", async () => {
        const kayak = await product({ quantity: 9 });
        const bySession = await book([{ productId: kayak }]);
        assert.equal((await update(move(bySession.id, day(END, 1)), session())).changed, true);

        const on = await agentKey();
        const asked = await book([{ productId: kayak }]);
        const refusal = await rejects(
          update(move(asked.id, day(END, 1)), on.call()),
          "CONFIRMATION_REQUIRED",
        );
        const preview = previewOf(refusal);
        assert.equal(preview.details.lines.length, 1);
        assert.ok(preview.details.lines[0]?.previousTotal && preview.details.lines[0]?.total);
        assert.equal(preview.details.overbooking, null);
        const done = await update(
          move(asked.id, day(END, 1)),
          on.call({ "louez-confirmation": tokenOf(refusal) }),
        );
        assert.equal(done.changed, true);
        // The token is spent.
        await rejects(
          update(move(asked.id, day(END, 2)), on.call({ "louez-confirmation": tokenOf(refusal) })),
          "CONFIRMATION_INVALID",
        );

        const off = await agentKey({ confirmSensitive: false });
        const direct = await book([{ productId: kayak }]);
        assert.equal((await update(move(direct.id, day(END, 1)), off.call())).changed, true);
        assert.equal((await changeMetadata(direct.id))?.actor, "api");
      });

      test("an override needs a person's approval, the option on or off; it is carried out once", async () => {
        for (const confirmSensitive of [true, false]) {
          const kayak = await product({ quantity: 9 });
          const { id } = await book([{ productId: kayak }]);
          const agent = await agentKey({ confirmSensitive });
          const input = move(id, day(END, 1), { allowOverbooking: true });

          const asked = await rejects(update(input, agent.call()), "APPROVAL_REQUIRED");
          assert.deepEqual(previewOf(asked).details.overbooking, { shortfalls: [] });
          const approval = await approvedOf(asked);
          const answer = await update(input, agent.call({ "louez-confirmation": approval }));
          assert.equal(answer.changed, true);
          const metadata = (await changeMetadata(id)) as Record<string, unknown>;
          // Nothing booked over: no credential for an override that passed nothing.
          assert.equal(metadata.overbooked, false);

          // Sent again: the dates are moved already, so nothing is asked or written.
          const again = await update(input, agent.call({ "louez-confirmation": approval }));
          assert.equal(again.changed, false);
          // The used approval carries no other change.
          await rejects(
            update(
              move(id, day(END, 2), { allowOverbooking: true }),
              agent.call({ "louez-confirmation": approval }),
            ),
            "APPROVAL_INVALID",
          );
          assert.equal((await changeRows(id)).length, 1, "carried out once");
        }
      });

      test("a competing booking after the approval voids it; the next preview shows the new shortfall", async () => {
        const kayak = await product({ quantity: 3 });
        const { id } = await book([{ productId: kayak, quantity: 2 }]);
        // Two of three taken the next day: the new dates are short by one.
        await book([{ productId: kayak, quantity: 2 }], { start: day(END, 1), end: day(END, 2) });
        const agent = await agentKey();
        const input = move(id, day(END, 2), { allowOverbooking: true });

        const asked = await rejects(update(input, agent.call()), "APPROVAL_REQUIRED");
        const said = (refusal: typeof asked) =>
          previewOf(refusal).details.overbooking?.shortfalls.map(({ requested, available }) => ({
            requested,
            available,
          }));
        assert.deepEqual(said(asked), [{ requested: 2, available: 1 }]);
        const approval = await approvedOf(asked);
        // Another booking takes the last kayak on the new days, without touching this one.
        await book([{ productId: kayak }], { start: day(END, 1), end: day(END, 2) });
        const before = await snapshot(id);

        const voided = await rejects(
          update(input, agent.call({ "louez-confirmation": approval })),
          "APPROVAL_INVALID",
        );
        assert.equal(voided.data.details?.reason, "state_changed");
        await unchanged(id, before);

        const again = await rejects(update(input, agent.call()), "APPROVAL_REQUIRED");
        assert.deepEqual(said(again), [{ requested: 2, available: 0 }]);
        const answer = await update(
          input,
          agent.call({ "louez-confirmation": await approvedOf(again) }),
        );
        assert.equal(answer.capacity.overbooked, true);
        const metadata = (await changeMetadata(id)) as Record<string, unknown>;
        assert.deepEqual(metadata.credential, { kind: "api_key", id: agent.id });
      });

      test("refusals come before anything is asked", async () => {
        const kayak = await product({ quantity: 1 });
        const agent = await agentKey();
        const full = await book([{ productId: kayak }]);
        await book([{ productId: kayak }], { start: day(END, 1), end: day(END, 2) });
        await rejects(
          update(move(full.id, day(END, 2)), agent.call()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );
        const insured = await book([{ productId: kayak }], {
          edit: { tulipInsuranceOptIn: true },
          start: day(END, 5),
          end: day(END, 6),
        });
        await rejects(
          update(move(insured.id, day(END, 7), { allowOverbooking: true }), agent.call()),
          "RESERVATION_EDIT_IN_DASHBOARD",
        );
        const handoffs = await louezDb.db.select().from(louezDb.apiHandoffs);
        const confirmations = await louezDb.db.select().from(louezDb.apiConfirmations);
        assert.equal(handoffs.length + confirmations.length, 0, "nothing was asked");
      });

      test("a read-only key is refused; another store's reservation is not found", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        const reader = await agentKey({ permissions: { ...everything, reservations: "read" } });
        await rejects(update(move(id, day(END, 1)), reader.call()), "PERMISSION_DENIED");

        const elsewhere = nextId("rd_res");
        await louezDb.db.insert(louezDb.reservations).values({
          id: elsewhere,
          storeId: OTHER_STORE,
          customerId: OTHER_CUSTOMER,
          number: elsewhere,
          status: "confirmed",
          startDate: START,
          endDate: END,
          subtotalAmount: "0.00",
          depositAmount: "0.00",
          totalAmount: "0.00",
          currency: "EUR",
        });
        await rejects(update(move(elsewhere, day(END, 1)), session()), "RESERVATION_NOT_FOUND");
      });
    });

    // --- Replay and no-op ---------------------------------------------------------------

    describe("a call sent again", () => {
      test("the same Idempotency-Key answers the first answer: one write, one message", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        const agent = await agentKey({ confirmSensitive: false });
        const input = move(id, day(END, 1), { notifyCustomer: true });

        const first = await update(input, agent.call({ "idempotency-key": "dates-1" }));
        const replayContext = agent.call({ "idempotency-key": "dates-1" });
        const second = await update(input, replayContext);

        assert.deepEqual(second, first);
        assert.equal(replayContext.receipt.replayed, true);
        assert.equal((await changeRows(id)).length, 1);
        assert.equal(
          (await outbox()).filter((row) => row.type === "reservation.modifiedEmail").length,
          1,
        );
      });

      test("the same dates again, without a key: changed false, nothing written, nothing sent", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        const agent = await agentKey({ confirmSensitive: false });
        await update(move(id, day(END, 1)), agent.call());
        const before = await snapshot(id);
        dispatched.length = 0;
        events.length = 0;

        const again = await update(move(id, day(END, 1), { notifyCustomer: true }), agent.call());

        assert.equal(again.changed, false);
        assert.equal(again.difference, "0.00");
        assert.equal(again.customerMessage, null);
        await unchanged(id, before);
        assert.deepEqual(dispatched, []);
        assert.deepEqual(events, []);
      });
    });

    // --- Races ----------------------------------------------------------------------------

    describe("races", () => {
      test("the answer is this change's, though another commits before it is read; its key replays it", async () => {
        const kayak = await product({ quantity: 9 });
        const lines = [{ productId: kayak }];
        const { id } = await book(lines, { end: day(START, 1) });
        const booked = await reservationRow(id);
        const agent = await agentKey({ confirmSensitive: false });
        const input = move(id, day(START, 2));
        // B moves the dates again, right after A's commit, before any read after it.
        const b = () => update(move(id, day(START, 3)), session());
        beforeReadAfterCommit = b;

        const first = await update(input, agent.call({ "idempotency-key": "dates-race-1" }));
        if (beforeReadAfterCommit) {
          beforeReadAfterCommit = null;
          await b();
        }

        const priced = await engine([{ productId: kayak, quantity: 1 }], {
          start: START,
          end: day(START, 2),
        });
        assert.equal(first.endDate.toISOString(), iso(day(START, 2)), "A's dates");
        assert.equal(first.totalAmount, priced.totalAmount, "A's total");
        assert.equal(first.previousTotal, booked.totalAmount);
        assert.equal(
          first.difference,
          (
            (Math.round(Number(priced.totalAmount) * 100) -
              Math.round(Number(booked.totalAmount) * 100)) /
            100
          ).toFixed(2),
        );
        assert.equal(
          (await reservationRow(id)).endDate.toISOString(),
          iso(day(START, 3)),
          "B's write stands",
        );
        const replay = await update(input, agent.call({ "idempotency-key": "dates-race-1" }));
        assert.deepEqual(replay, first);
      });

      test("two date changes at once: each runs on what the other committed", async () => {
        const kayak = await product({ quantity: 9 });
        const lines = [{ productId: kayak }];
        const { id } = await book(lines);

        const answers = await raceOnLockedRow(database, { table: "reservations", id }, [
          () => update(move(id, day(END, 1)), session()),
          () => update(move(id, day(END, 3)), session()),
        ]);

        const ends = answers.map((answer) => answer.previousEndDate.toISOString()).sort();
        // One saw the stored end, the other the end the first wrote.
        assert.ok(ends.includes(iso(END)), JSON.stringify(ends));
        const final = await reservationRow(id);
        await assertPricedByEngine(id, lines, { start: START, end: final.endDate });
        assert.equal((await changeRows(id)).length, 2);
      });

      test("a date change queued behind a cancellation: the cancellation first, the change refused under the lock", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        const client = orpc.createRouterClient(router, {
          context: session(),
          path: ["dashboard", "reservations"],
        }) as Client;
        const settle = <T>(call: Promise<T>) =>
          call.then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
        const holder = await database.connect();
        let cancelled: { value?: unknown; error?: unknown };
        let changed: { value?: unknown; error?: unknown };
        try {
          await holder.beginTransaction();
          await holder.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [kayak]);
          const cancelling = settle(client.cancel({ id }));
          await waitForLockWaits(holder, database.name, 1);
          // It read the status before the cancellation committed: confirmed.
          const changing = settle(update(move(id, day(END, 1)), session()));
          await waitForLockWaits(holder, database.name, 2);
          await holder.commit();
          cancelled = await cancelling;
          changed = await changing;
        } finally {
          await holder.end();
        }
        assert.ok("value" in cancelled, String(cancelled.error));
        assert.equal(
          (changed.error as { data?: { code?: string } } | undefined)?.data?.code,
          "RESERVATION_NOT_EDITABLE",
        );
        const row = await reservationRow(id);
        assert.equal(row.status, "cancelled");
        assert.equal(row.endDate.toISOString(), iso(END));
      });
    });

    // --- The message ------------------------------------------------------------------------

    describe("the customer's message", () => {
      test("queued with the change, once, to the address the preview named; sent after the commit", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        const agent = await agentKey();
        const input = move(id, day(END, 1), { notifyCustomer: true });

        const asked = await rejects(update(input, agent.call()), "CONFIRMATION_REQUIRED");
        assert.deepEqual(previewOf(asked).details.messages, [
          { message: "reservation_modified", channel: "email", to: "ada@rd.test" },
        ]);
        assert.equal((await outbox()).length, 0, "nothing queued by the preview");
        const answer = await update(input, agent.call({ "louez-confirmation": tokenOf(asked) }));

        assert.deepEqual(answer.customerMessage, { channel: "email", to: "ada@rd.test" });
        const rows = await outbox();
        assert.deepEqual(rows, [
          {
            type: "reservation.modifiedEmail",
            payload: {
              storeId: STORE,
              reservationId: id,
              to: "ada@rd.test",
              previousPeriod: { startDate: iso(START), endDate: iso(END) },
              period: { startDate: iso(START), endDate: iso(day(END, 1)) },
              userId: OWNER,
            },
          },
        ]);
        assert.equal(dispatched.length, 1);
      });

      test("a changed address voids the token: the message goes where the preview said or not at all", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        const agent = await agentKey();
        const input = move(id, day(END, 1), { notifyCustomer: true });
        const asked = await rejects(update(input, agent.call()), "CONFIRMATION_REQUIRED");
        await louezDb.db
          .update(louezDb.customers)
          .set({ email: "ada.new@rd.test" })
          .where(orm.eq(louezDb.customers.id, CUSTOMER));

        await rejects(
          update(input, agent.call({ "louez-confirmation": tokenOf(asked) })),
          "CONFIRMATION_INVALID",
        );
        assert.equal((await outbox()).length, 0);
      });

      test("not queued on a refusal; refused before anything is asked when no e-mail can reach the customer", async () => {
        const kayak = await product({ quantity: 1 });
        const { id } = await book([{ productId: kayak }]);
        await book([{ productId: kayak }], { start: day(END, 1), end: day(END, 2) });
        const agent = await agentKey();
        await rejects(
          update(move(id, day(END, 2), { notifyCustomer: true }), agent.call()),
          "RESERVATION_INSUFFICIENT_CAPACITY",
        );

        emailConfigured = false;
        const noSmtp = await rejects(
          update(move(id, day(END, 1), { notifyCustomer: true }), agent.call()),
          "RESERVATION_CUSTOMER_UNREACHABLE",
        );
        assert.equal(noSmtp.data.details?.reason, "email_not_configured");
        emailConfigured = true;

        await louezDb.db
          .update(louezDb.customers)
          .set({ email: "" })
          .where(orm.eq(louezDb.customers.id, CUSTOMER));
        const noEmail = await rejects(
          update(move(id, day(END, 1), { notifyCustomer: true }), agent.call()),
          "RESERVATION_CUSTOMER_UNREACHABLE",
        );
        assert.equal(noEmail.data.details?.reason, "no_email");
        assert.equal((await outbox()).length, 0);
        const asked = await louezDb.db.select().from(louezDb.apiConfirmations);
        assert.equal(asked.length, 0, "nothing was asked");
      });

      test("after the commit: the pages and the analytics event, through afterCommit; never the insurer", async () => {
        const kayak = await product({ quantity: 9 });
        const { id } = await book([{ productId: kayak }]);
        await update(move(id, day(END, 1)), session());
        assert.deepEqual(
          events.map((event) => event.type),
          ["reservation.datesChanged"],
        );
        assert.deepEqual(
          events[0] && "reservationId" in events[0] ? events[0].reservationId : null,
          id,
        );
      });
    });
  },
);
