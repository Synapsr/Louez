import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  createTestDatabase,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

// The customer's three status changes from the account page, on a database:
// accepting a quote, declining it, cancelling a request. Each case reads the
// answer, the status, every activity row with its metadata, the fee effects
// the runner gets, and every call the action makes outside the database, with
// its payload, in order. They describe the actions as they are, so a move of
// their status change into packages/api must leave every one of them passing
// unchanged (docs/domain/reservation-changes.md, slice 6a-2).

const directory = mkdtempSync(join(tmpdir(), "louez-customer-status-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezCustomerStatusStubs;");
after(() => rmSync(directory, { recursive: true }));

// What the actions call besides the database: the customer's session, the
// Stripe session, the contract link, the store's and the customer's messages,
// analytics, the insurer, the fee runner, the gate's log, the log and the page
// cache. Each records its call.
const STUBBED = new Set([
  "next/cache",
  "@/lib/customer-auth/session",
  "@/lib/customer-auth/instant-access",
  "@/lib/notifications/customer-dispatcher",
  "@/lib/notifications/dispatcher",
  "@/lib/product-analytics/analytics",
  "@/lib/reservations/payment-session",
  "@/lib/integrations/tulip/contracts",
  "@/lib/billing/reservation-effects",
  "@/lib/billing/reservation-gate",
  "@/lib/evlog",
]);

type Call = [name: string, ...args: unknown[]];
const calls: Call[] = [];
const record =
  (name: string, answer: (...args: unknown[]) => unknown = () => undefined) =>
  (...args: unknown[]) => {
    calls.push([name, ...structuredClone(args)]);
    return answer(...args);
  };

const CONTRACT_URL = "https://shop.example.test/contract-link";
const PAYMENT_URL = "https://checkout.example.test/session";
/** What the Stripe session answers, or throws. */
let paymentSession: () => Promise<unknown> = async () => ({
  success: true,
  paymentUrl: PAYMENT_URL,
});
/** Whose session the customer's cookie carries. */
let sessionCustomerId = "";

Reflect.set(globalThis, "__louezCustomerStatusStubs", {
  revalidatePath: record("revalidatePath"),
  getCustomerSession: record("getCustomerSession", async () => ({
    customerId: sessionCustomerId,
  })),
  createReservationInstantAccessUrl: record(
    "createReservationInstantAccessUrl",
    async () => CONTRACT_URL,
  ),
  dispatchCustomerNotification: record("dispatchCustomerNotification", async () => ({})),
  dispatchNotification: record("dispatchNotification", async () => ({})),
  captureProductServerEvent: record("captureProductServerEvent", async () => {}),
  toAnalyticsAmountCents: (value: string) => Math.round(Number(value) * 100),
  createReservationPaymentSessionForCustomer: record(
    "createReservationPaymentSessionForCustomer",
    () => paymentSession(),
  ),
  cancelTulipContractForReservation: record("cancelTulipContractForReservation", async () => {}),
  runReservationEffects: record("runReservationEffects", async () => {}),
  logReservationGateRefusal: (refusal: { storeId: string; reason: string }, surface: string) => {
    calls.push([
      "logReservationGateRefusal",
      { storeId: refusal.storeId, reason: refusal.reason },
      surface,
    ]);
  },
  log: {
    error: record("log.error"),
    warn: record("log.warn"),
    info: record("log.info"),
  },
});

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only" || specifier === "@/lib/storage/files") {
      return { url: "node:module", shortCircuit: true };
    }
    const parent = context.parentURL ? decodeURIComponent(context.parentURL) : "";
    if (parent.endsWith("/[reservationId]/actions.ts") && STUBBED.has(specifier)) {
      return { url: pathToFileURL(stubsPath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const STORE = "store_customer_status";
const STORE_SLUG = "customer-status";
const PAY_STORE = "store_customer_paying";
const PAY_STORE_SLUG = "customer-paying";
const GATE_STORE = "store_customer_gated";
const GATE_STORE_SLUG = "customer-gated";
const CUSTOMER = "cus_ada_status";
const OTHER_CUSTOMER = "cus_grace_status";
const START = new Date("2030-06-01T09:00:00Z");
const END = new Date("2030-06-03T09:00:00Z");

describe("the customer's status changes (database)", { skip: skipWithoutTestDatabase() }, () => {
  const hooks = reservationChangeTestHooks();
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let actions: typeof import("./actions");
  let storefront: typeof import("@/lib/storefront-url");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("customer_status");
    louezDb = await import("@louez/db");
    actions = await import("./actions");
    storefront = await import("@/lib/storefront-url");

    const contact = { phone: "+33 6 00 00 00 00", email: "shop@status.test" };
    await louezDb.db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: "owner_customer_status",
        name: "Status",
        slug: STORE_SLUG,
        ...contact,
        cgv: "The terms.",
        ownerPhone: "+33 6 11 11 11 11",
        settings: {
          reservationMode: "request",
          currency: "EUR",
          advanceNoticeMinutes: 0,
          pendingBlocksAvailability: false,
        },
      },
      {
        id: PAY_STORE,
        userId: "owner_customer_paying",
        name: "Paying",
        slug: PAY_STORE_SLUG,
        ...contact,
        stripeAccountId: "acct_customer_paying",
        stripeChargesEnabled: true,
        settings: {
          reservationMode: "payment",
          currency: "EUR",
          advanceNoticeMinutes: 0,
          pendingBlocksAvailability: false,
        },
      },
      {
        // Created after BILLING_NEW_STORES_FROM, with no policy: its card gate
        // fails closed while the billing service is on (README §8.3).
        id: GATE_STORE,
        userId: "owner_customer_gated",
        name: "Gated",
        slug: GATE_STORE_SLUG,
        ...contact,
        createdAt: new Date("2027-02-01T00:00:00Z"),
        settings: {
          reservationMode: "request",
          currency: "EUR",
          advanceNoticeMinutes: 0,
          pendingBlocksAvailability: false,
        },
      },
    ]);
    for (const storeId of [STORE, PAY_STORE, GATE_STORE]) {
      for (const [id, firstName] of [
        [CUSTOMER, "Ada"],
        [OTHER_CUSTOMER, "Grace"],
      ] as const) {
        await louezDb.db.insert(louezDb.customers).values({
          id: customerOf(storeId, id),
          storeId,
          email: `${firstName.toLowerCase()}@${storeId}.test`,
          firstName,
          lastName: "Customer",
          phone: firstName === "Ada" ? "+33 6 22 22 22 22" : null,
        });
      }
    }
  });

  after(async () => {
    hooks.beforeReservationLock = null;
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    calls.length = 0;
    hooks.restarts = 0;
    hooks.beforeReservationLock = null;
    sessionCustomerId = CUSTOMER;
    paymentSession = async () => ({ success: true, paymentUrl: PAYMENT_URL });
  });

  // 21 characters, as nanoid ids: the actions check their shape.
  const nextId = (prefix: string) =>
    `${prefix}_${String(++counter).padStart(20 - prefix.length, "0")}`;

  /** The customer row of `customerId` in `storeId`, as `before` named it. */
  const customerOf = (storeId: string, customerId = CUSTOMER) =>
    storeId === STORE ? customerId : `${customerId}_${storeId === PAY_STORE ? "p" : "g"}`;

  /**
   * A reservation of one line of a product that has `stock` units, for the
   * customer of `storeId`. Priced in pounds, which is not the store's currency:
   * the messages carry the reservation's.
   */
  async function reservationOf(
    status: "quote" | "pending" | "confirmed" | "cancelled",
    options: {
      storeId?: string;
      customerId?: string;
      stock?: number;
      productId?: string;
      tulipContractId?: string | null;
    } = {},
  ) {
    const storeId = options.storeId ?? STORE;
    const productId = options.productId ?? nextId("prd");
    if (!options.productId) {
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId,
        name: productId,
        price: "5.00",
        pricingMode: "day",
        quantity: options.stock ?? 5,
      });
    }
    const id = nextId("res");
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId: customerOf(storeId, options.customerId),
      number: `N-${counter}`,
      status,
      startDate: START,
      endDate: END,
      subtotalAmount: "10.00",
      depositAmount: "5.00",
      totalAmount: "12.50",
      currency: "GBP",
      source: "online",
      tulipContractId: options.tulipContractId ?? null,
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: nextId("itm"),
      reservationId: id,
      productId,
      quantity: 1,
      unitPrice: "5.00",
      depositPerUnit: "5.00",
      totalPrice: "10.00",
      productSnapshot: { name: "Kayak", description: null, images: [] },
    });
    return { id, productId };
  }

  async function storeRow(storeId: string) {
    const store = await louezDb.db.query.stores.findFirst({
      where: eq(louezDb.stores.id, storeId),
    });
    assert.ok(store);
    return store;
  }

  async function customerRow(storeId: string) {
    const customer = await louezDb.db.query.customers.findFirst({
      where: eq(louezDb.customers.id, customerOf(storeId)),
    });
    assert.ok(customer);
    return customer;
  }

  async function reservationRow(id: string) {
    const row = await louezDb.db.query.reservations.findFirst({
      where: eq(louezDb.reservations.id, id),
    });
    assert.ok(row);
    return row;
  }

  /** Every activity row of the reservation, sorted by type; dates written now read as "<now>". */
  async function activityOf(id: string) {
    const rows = await louezDb.db
      .select({
        type: louezDb.reservationActivity.activityType,
        userId: louezDb.reservationActivity.userId,
        description: louezDb.reservationActivity.description,
        metadata: louezDb.reservationActivity.metadata,
      })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, id));
    return rows
      .map((row) => {
        const metadata = { ...(row.metadata as Record<string, unknown> | null) };
        if (typeof metadata.validatedAt === "string") metadata.validatedAt = "<now>";
        return { ...row, metadata };
      })
      .sort((a, b) => a.type.localeCompare(b.type));
  }

  const CONTRACT_ROW = {
    type: "modified",
    userId: null,
    description: null,
    metadata: {
      kind: "automatic_contract_validation",
      source: "quote_acceptance",
      validatedAt: "<now>",
    },
  };

  /** Each run of the owner entry loses a deadlock before it gets the reservation, `times` times. */
  function loseDeadlocks(times: number) {
    let left = times;
    hooks.beforeReservationLock = async () => {
      if (left <= 0) return;
      left -= 1;
      throw Object.assign(new Error("Deadlock found when trying to get lock"), {
        code: "ER_LOCK_DEADLOCK",
        errno: 1213,
      });
    };
  }

  /**
   * Records, as each run reaches the reservation's row lock, the scope it locks
   * and whether the reservation's product is already locked by then: another
   * connection asks for it without waiting.
   */
  function watchLock(productId: string) {
    const seen: Array<{ scope: unknown; productLocked: boolean }> = [];
    hooks.beforeReservationLock = async (scope) => {
      const other = await database.connect();
      let productLocked = false;
      try {
        await other.beginTransaction();
        await other.query("SELECT id FROM products WHERE id = ? FOR UPDATE NOWAIT", [productId]);
      } catch (error) {
        productLocked = (error as { errno?: number }).errno === 3572;
        if (!productLocked) throw error;
      } finally {
        await other.rollback();
        await other.end();
      }
      seen.push({ scope: { ...scope }, productLocked });
    };
    return seen;
  }

  /** The reservation's status changed by another connection while the action waits for its lock. */
  function changeStatusBeforeLock(id: string, status: "confirmed" | "cancelled") {
    let done = false;
    hooks.beforeReservationLock = async () => {
      if (done) return;
      done = true;
      const other = await database.connect();
      try {
        await other.query("UPDATE reservations SET reservation_status = ? WHERE id = ?", [
          status,
          id,
        ]);
      } finally {
        await other.end();
      }
    };
  }

  const names = () => calls.map(([name]) => name);
  const sessionCall: Call = ["getCustomerSession", STORE];
  const revalidations = (slug: string, id: string): Call[] => [
    ["revalidatePath", `/${slug}/account`],
    ["revalidatePath", `/${slug}/account/reservations/${id}`],
  ];

  async function feeRecordOf(id: string, storeId = STORE) {
    const row = await reservationRow(id);
    assert.ok(row.billableAt);
    return {
      type: "legacy_fee.record",
      storeId,
      reservationId: id,
      marketplace: false,
      at: row.billableAt,
    };
  }

  const feeVoidOf = (id: string, storeId = STORE) => ({
    type: "legacy_fee.void",
    storeId,
    reservationId: id,
  });

  /** The store's `reservation_confirmed` or `reservation_cancelled` of a quote, as the actions send it. */
  async function ownerQuoteMessage(
    event: "reservation_confirmed" | "reservation_cancelled",
    id: string,
    storeId: string,
  ): Promise<Call> {
    const store = await storeRow(storeId);
    const customer = await customerRow(storeId);
    const reservation = await reservationRow(id);
    return [
      "dispatchNotification",
      event,
      {
        actor: "customer",
        ...(event === "reservation_cancelled" ? { quoteDeclined: true } : {}),
        store: {
          id: store.id,
          name: store.name,
          email: store.email,
          discordWebhookUrl: store.discordWebhookUrl,
          ownerPhone: store.ownerPhone,
          notificationSettings: store.notificationSettings,
          settings: store.settings,
        },
        reservation: {
          id,
          number: reservation.number,
          startDate: START,
          endDate: END,
          totalAmount: 12.5,
          currency: "GBP",
        },
        customer: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
        },
      },
    ];
  }

  /** The acceptance's calls once its transaction committed, from the analytics on. */
  async function acceptanceCalls(
    id: string,
    storeId: string,
    slug: string,
    options: { mode: "request" | "payment"; paymentUrl: string | null; sessionCalls?: Call[] },
  ): Promise<Call[]> {
    const store = await storeRow(storeId);
    const customer = await customerRow(storeId);
    const reservation = await reservationRow(id);
    return [
      ["getCustomerSession", storeId],
      [
        "captureProductServerEvent",
        {
          distinctId: customer.id,
          event: "quote_accepted",
          properties: {
            feature: "customer_account",
            surface: "storefront",
            store_id: storeId,
            reservation_id: id,
            customer_id: customer.id,
            source: "customer_account",
            reservation_mode: options.mode,
            catalog_line_count: 1,
            total_amount_cents: 1250,
            deposit_amount_cents: 500,
            currency: "GBP",
          },
        },
      ],
      ...(options.sessionCalls ?? []),
      ["runReservationEffects", [await feeRecordOf(id, storeId)]],
      await ownerQuoteMessage("reservation_confirmed", id, storeId),
      [
        "createReservationInstantAccessUrl",
        {
          storeId,
          storeSlug: slug,
          customerEmail: customer.email,
          reservationId: id,
          redirectPath: `/account/reservations/${id}/contract`,
        },
      ],
      [
        "dispatchCustomerNotification",
        "customer_quote_accepted",
        {
          store: {
            id: store.id,
            name: store.name,
            email: store.email,
            logoUrl: store.logoUrl,
            darkLogoUrl: store.darkLogoUrl,
            address: store.address,
            phone: store.phone,
            theme: store.theme,
            settings: store.settings,
            emailSettings: store.emailSettings,
            customerNotificationSettings: store.customerNotificationSettings,
          },
          customer: {
            id: customer.id,
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
          },
          reservation: {
            id,
            number: reservation.number,
            startDate: START,
            endDate: END,
            totalAmount: 12.5,
            subtotalAmount: 10,
            depositAmount: 5,
            currency: "GBP",
          },
          items: [{ name: "Kayak", quantity: 1, unitPrice: 5, totalPrice: 10 }],
          reservationUrl: storefront.getStorefrontUrl(slug, `/account/reservations/${id}`),
          contractUrl: CONTRACT_URL,
          termsUrl: store.cgv?.trim() ? storefront.getStorefrontUrl(slug, "/terms") : null,
          paymentUrl: options.paymentUrl,
        },
      ],
      ...revalidations(slug, id),
    ];
  }

  const acceptedRow = {
    type: "quote_accepted",
    userId: null,
    description: null,
    metadata: {
      previousStatus: "quote",
      newStatus: "confirmed",
      actor: "customer",
      source: "quote_acceptance",
      overbooked: false,
    },
  };

  describe("acceptQuote", () => {
    test("in request mode: confirmed, the fee, the store's message, then the customer's with its contract link", async () => {
      const { id } = await reservationOf("quote");

      const result = await actions.acceptQuote(STORE_SLUG, id);

      assert.deepEqual(result, { success: true, paymentUrl: null });
      const row = await reservationRow(id);
      assert.equal(row.status, "confirmed");
      assert.ok(row.contractValidatedAt);
      assert.deepEqual(await activityOf(id), [CONTRACT_ROW, acceptedRow]);
      assert.deepEqual(
        calls,
        await acceptanceCalls(id, STORE, STORE_SLUG, { mode: "request", paymentUrl: null }),
      );
    });

    test("in payment mode: the Stripe session, then the fee, then the store's message, then the customer's with the payment link", async () => {
      const { id } = await reservationOf("quote", { storeId: PAY_STORE });
      sessionCustomerId = customerOf(PAY_STORE);

      const result = await actions.acceptQuote(PAY_STORE_SLUG, id);

      assert.deepEqual(result, { success: true, paymentUrl: PAYMENT_URL });
      assert.equal((await reservationRow(id)).status, "confirmed");
      assert.deepEqual(await activityOf(id), [CONTRACT_ROW, acceptedRow]);
      assert.deepEqual(
        calls,
        await acceptanceCalls(id, PAY_STORE, PAY_STORE_SLUG, {
          mode: "payment",
          paymentUrl: PAYMENT_URL,
          sessionCalls: [
            [
              "createReservationPaymentSessionForCustomer",
              PAY_STORE_SLUG,
              id,
              customerOf(PAY_STORE),
              "quote_acceptance",
            ],
          ],
        }),
      );
    });

    test("a Stripe session that throws: the fee is still attempted, then the action throws and sends nothing", async () => {
      const { id } = await reservationOf("quote", { storeId: PAY_STORE });
      sessionCustomerId = customerOf(PAY_STORE);
      paymentSession = async () => {
        throw new Error("Stripe unavailable");
      };

      await assert.rejects(actions.acceptQuote(PAY_STORE_SLUG, id), /Stripe unavailable/);

      // The transaction committed before the session.
      assert.equal((await reservationRow(id)).status, "confirmed");
      assert.deepEqual(await activityOf(id), [CONTRACT_ROW, acceptedRow]);
      const expected = await acceptanceCalls(id, PAY_STORE, PAY_STORE_SLUG, {
        mode: "payment",
        paymentUrl: null,
        sessionCalls: [
          [
            "createReservationPaymentSessionForCustomer",
            PAY_STORE_SLUG,
            id,
            customerOf(PAY_STORE),
            "quote_acceptance",
          ],
        ],
      });
      assert.deepEqual(calls, expected.slice(0, 4));
      assert.deepEqual(names(), [
        "getCustomerSession",
        "captureProductServerEvent",
        "createReservationPaymentSessionForCustomer",
        "runReservationEffects",
      ]);
    });

    test("a failed Stripe session other than already paid is logged, and the customer gets no payment link", async () => {
      const { id } = await reservationOf("quote", { storeId: PAY_STORE });
      sessionCustomerId = customerOf(PAY_STORE);
      paymentSession = async () => ({ success: false, error: "errors.stripeNotConfigured" });

      const result = await actions.acceptQuote(PAY_STORE_SLUG, id);

      assert.deepEqual(result, { success: true, paymentUrl: null });
      assert.equal((await reservationRow(id)).status, "confirmed");
      assert.deepEqual(
        calls,
        await acceptanceCalls(id, PAY_STORE, PAY_STORE_SLUG, {
          mode: "payment",
          paymentUrl: null,
          sessionCalls: [
            [
              "createReservationPaymentSessionForCustomer",
              PAY_STORE_SLUG,
              id,
              customerOf(PAY_STORE),
              "quote_acceptance",
            ],
            [
              "log.error",
              "reservation",
              `quote payment session failed (${id}): errors.stripeNotConfigured`,
            ],
          ],
        }),
      );
    });

    test("a quote already paid gets no payment link, and nothing is logged", async () => {
      const { id } = await reservationOf("quote", { storeId: PAY_STORE });
      sessionCustomerId = customerOf(PAY_STORE);
      paymentSession = async () => ({ success: false, error: "errors.alreadyPaid" });

      const result = await actions.acceptQuote(PAY_STORE_SLUG, id);

      assert.deepEqual(result, { success: true, paymentUrl: null });
      assert.deepEqual(
        calls,
        await acceptanceCalls(id, PAY_STORE, PAY_STORE_SLUG, {
          mode: "payment",
          paymentUrl: null,
          sessionCalls: [
            [
              "createReservationPaymentSessionForCustomer",
              PAY_STORE_SLUG,
              id,
              customerOf(PAY_STORE),
              "quote_acceptance",
            ],
          ],
        }),
      );
    });

    test("takes the products' lock, then the reservation's, scoped to the store", async () => {
      const { id, productId } = await reservationOf("quote");
      const seen = watchLock(productId);

      assert.deepEqual(await actions.acceptQuote(STORE_SLUG, id), {
        success: true,
        paymentUrl: null,
      });
      assert.deepEqual(seen, [
        { scope: { reservationId: id, storeId: STORE }, productLocked: true },
      ]);
    });

    test("runs again when it loses a deadlock, and records the fee once", async () => {
      const { id } = await reservationOf("quote");
      loseDeadlocks(1);

      const result = await actions.acceptQuote(STORE_SLUG, id);

      assert.deepEqual(result, { success: true, paymentUrl: null });
      assert.equal(hooks.restarts, 1, "the transaction ran twice");
      assert.deepEqual(await activityOf(id), [CONTRACT_ROW, acceptedRow]);
      assert.deepEqual(
        calls,
        await acceptanceCalls(id, STORE, STORE_SLUG, { mode: "request", paymentUrl: null }),
      );
    });

    test("busy on each of its three runs: tryAgain, nothing written, nothing else done", async () => {
      const { id } = await reservationOf("quote");
      loseDeadlocks(3);

      assert.deepEqual(await actions.acceptQuote(STORE_SLUG, id), { error: "tryAgain" });

      assert.equal(hooks.restarts, 2, "three runs in all");
      assert.equal((await reservationRow(id)).status, "quote");
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a reservation that is no longer a quote: invalidStatus, nothing written or sent", async () => {
      const { id } = await reservationOf("confirmed");

      assert.deepEqual(await actions.acceptQuote(STORE_SLUG, id), { error: "invalidStatus" });

      assert.equal((await reservationRow(id)).status, "confirmed");
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a quote the store confirmed between the read and the lock: invalidStatus, nothing written or sent", async () => {
      const { id } = await reservationOf("quote");
      changeStatusBeforeLock(id, "confirmed");

      assert.deepEqual(await actions.acceptQuote(STORE_SLUG, id), { error: "invalidStatus" });

      assert.equal((await reservationRow(id)).status, "confirmed");
      assert.equal((await reservationRow(id)).contractValidatedAt, null);
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("short stock: the stock refusal's key, nothing written or sent", async () => {
      const { id, productId } = await reservationOf("quote", { stock: 1 });
      // A confirmed booking of the same dates holds the only one.
      await reservationOf("confirmed", { productId, customerId: OTHER_CUSTOMER });

      const result = await actions.acceptQuote(STORE_SLUG, id);

      assert.deepEqual(result, { error: "errors.productNoLongerAvailable" });
      assert.equal((await reservationRow(id)).status, "quote");
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a held unit another booking holds: the same key, no unit named, nothing written or sent", async () => {
      const productId = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId: STORE,
        name: productId,
        price: "5.00",
        pricingMode: "day",
        trackUnits: true,
        quantity: 2,
      });
      const unitId = nextId("unt");
      await louezDb.db.insert(louezDb.productUnits).values({
        id: unitId,
        productId,
        identifier: `SECRET-${unitId}`,
      });
      await louezDb.db.insert(louezDb.productUnits).values({
        id: nextId("unt"),
        productId,
        identifier: "SPARE",
      });
      const holding = async (status: "quote" | "confirmed") => {
        const { id } = await reservationOf(status, { productId });
        const [item] = await louezDb.db
          .select({ id: louezDb.reservationItems.id })
          .from(louezDb.reservationItems)
          .where(eq(louezDb.reservationItems.reservationId, id));
        assert.ok(item);
        await louezDb.db.insert(louezDb.reservationItemUnits).values({
          id: nextId("asg"),
          reservationItemId: item.id,
          productUnitId: unitId,
          identifierSnapshot: `SECRET-${unitId}`,
        });
        return id;
      };
      const id = await holding("quote");
      await holding("confirmed");

      const result = await actions.acceptQuote(STORE_SLUG, id);

      assert.deepEqual(result, { error: "errors.productNoLongerAvailable" });
      assert.ok(!JSON.stringify(result).includes("SECRET"));
      assert.equal((await reservationRow(id)).status, "quote");
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a closed card gate: the generic key with the store's contact, the refusal logged, nothing written or sent", async () => {
      const saved = {
        billing: process.env.LOUEZ_BILLING,
        url: process.env.BILLING_SERVICE_URL,
        from: process.env.BILLING_NEW_STORES_FROM,
      };
      process.env.LOUEZ_BILLING = "cloud";
      process.env.BILLING_SERVICE_URL = "http://localhost:3100";
      process.env.BILLING_NEW_STORES_FROM = "2027-01-25T00:00:00Z";
      try {
        const { id } = await reservationOf("quote", { storeId: GATE_STORE });
        sessionCustomerId = customerOf(GATE_STORE);

        const result = await actions.acceptQuote(GATE_STORE_SLUG, id);

        assert.deepEqual(result, {
          error: "errors.storeNotAcceptingReservations",
          errorParams: { hasContact: "yes", contact: "+33 6 00 00 00 00 · shop@status.test" },
        });
        assert.equal((await reservationRow(id)).status, "quote");
        assert.deepEqual(await activityOf(id), []);
        assert.deepEqual(calls, [
          ["getCustomerSession", GATE_STORE],
          [
            "logReservationGateRefusal",
            { storeId: GATE_STORE, reason: "payment_method_required" },
            "quote_acceptance",
          ],
        ]);
      } finally {
        for (const [name, value] of [
          ["LOUEZ_BILLING", saved.billing],
          ["BILLING_SERVICE_URL", saved.url],
          ["BILLING_NEW_STORES_FROM", saved.from],
        ] as const) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    });

    test("another customer's quote: reservationNotFound, nothing written or sent", async () => {
      const { id } = await reservationOf("quote", { customerId: OTHER_CUSTOMER });

      assert.deepEqual(await actions.acceptQuote(STORE_SLUG, id), {
        error: "reservationNotFound",
      });

      assert.equal((await reservationRow(id)).status, "quote");
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a second call after a success: invalidStatus, and nothing runs again", async () => {
      const { id } = await reservationOf("quote");
      await actions.acceptQuote(STORE_SLUG, id);
      calls.length = 0;

      assert.deepEqual(await actions.acceptQuote(STORE_SLUG, id), { error: "invalidStatus" });

      assert.deepEqual(await activityOf(id), [CONTRACT_ROW, acceptedRow]);
      assert.deepEqual(calls, [sessionCall]);
    });
  });

  describe("declineQuote", () => {
    const declinedRow = {
      type: "quote_declined",
      userId: null,
      description: null,
      metadata: {
        previousStatus: "quote",
        newStatus: "declined",
        actor: "customer",
        source: "quote_decline",
      },
    };

    async function declineCalls(id: string): Promise<Call[]> {
      return [
        sessionCall,
        ["runReservationEffects", [feeVoidOf(id)]],
        [
          "captureProductServerEvent",
          {
            distinctId: CUSTOMER,
            event: "quote_declined",
            properties: {
              feature: "customer_account",
              surface: "storefront",
              store_id: STORE,
              reservation_id: id,
              customer_id: CUSTOMER,
              source: "customer_account",
              total_amount_cents: 1250,
              currency: "GBP",
            },
          },
        ],
        await ownerQuoteMessage("reservation_cancelled", id, STORE),
        ...revalidations(STORE_SLUG, id),
      ];
    }

    test("declined: the fee voided, then analytics, then the store's message; the customer gets nothing", async () => {
      const { id } = await reservationOf("quote");

      assert.deepEqual(await actions.declineQuote(STORE_SLUG, id), { success: true });

      assert.equal((await reservationRow(id)).status, "declined");
      assert.deepEqual(await activityOf(id), [declinedRow]);
      assert.deepEqual(calls, await declineCalls(id));
    });

    test("takes the reservation's lock alone, scoped to the store", async () => {
      const { id, productId } = await reservationOf("quote");
      const seen = watchLock(productId);

      assert.deepEqual(await actions.declineQuote(STORE_SLUG, id), { success: true });
      assert.deepEqual(seen, [
        { scope: { reservationId: id, storeId: STORE }, productLocked: false },
      ]);
    });

    test("runs again when it loses a deadlock, and voids the fee once", async () => {
      const { id } = await reservationOf("quote");
      loseDeadlocks(1);

      assert.deepEqual(await actions.declineQuote(STORE_SLUG, id), { success: true });

      assert.equal(hooks.restarts, 1);
      assert.deepEqual(await activityOf(id), [declinedRow]);
      assert.deepEqual(calls, await declineCalls(id));
    });

    test("busy on each of its three runs: tryAgain, nothing written, nothing else done", async () => {
      const { id } = await reservationOf("quote");
      loseDeadlocks(3);

      assert.deepEqual(await actions.declineQuote(STORE_SLUG, id), { error: "tryAgain" });

      assert.equal(hooks.restarts, 2);
      assert.equal((await reservationRow(id)).status, "quote");
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a reservation that is no longer a quote: invalidStatus, nothing written or sent", async () => {
      const { id } = await reservationOf("confirmed");

      assert.deepEqual(await actions.declineQuote(STORE_SLUG, id), { error: "invalidStatus" });

      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a quote the store confirmed between the read and the lock: invalidStatus, nothing written or sent", async () => {
      const { id } = await reservationOf("quote");
      changeStatusBeforeLock(id, "confirmed");

      assert.deepEqual(await actions.declineQuote(STORE_SLUG, id), { error: "invalidStatus" });

      assert.equal((await reservationRow(id)).status, "confirmed");
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("another customer's quote: reservationNotFound, nothing written or sent", async () => {
      const { id } = await reservationOf("quote", { customerId: OTHER_CUSTOMER });

      assert.deepEqual(await actions.declineQuote(STORE_SLUG, id), {
        error: "reservationNotFound",
      });

      assert.equal((await reservationRow(id)).status, "quote");
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a second call after a success: invalidStatus, and nothing runs again", async () => {
      const { id } = await reservationOf("quote");
      await actions.declineQuote(STORE_SLUG, id);
      calls.length = 0;

      assert.deepEqual(await actions.declineQuote(STORE_SLUG, id), { error: "invalidStatus" });

      assert.deepEqual(await activityOf(id), [declinedRow]);
      assert.deepEqual(calls, [sessionCall]);
    });
  });

  describe("cancelReservationRequest", () => {
    const cancelledRow = {
      type: "cancelled",
      userId: null,
      description: null,
      metadata: {
        previousStatus: "pending",
        newStatus: "cancelled",
        actor: "customer",
        source: "customer_request_cancellation",
      },
    };

    const cancelRevalidations = (id: string): Call[] => [
      ...revalidations(STORE_SLUG, id),
      ["revalidatePath", "/dashboard/reservations"],
      ["revalidatePath", `/dashboard/reservations/${id}`],
    ];

    async function ownerCancellation(id: string): Promise<Call> {
      const customer = await customerRow(STORE);
      const reservation = await reservationRow(id);
      return [
        "dispatchNotification",
        "reservation_cancelled",
        {
          actor: "customer",
          store: await storeRow(STORE),
          reservation: {
            id,
            number: reservation.number,
            startDate: START,
            endDate: END,
            totalAmount: 12.5,
            currency: "GBP",
          },
          customer: {
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
          },
        },
      ];
    }

    async function paymentOf(
      reservationId: string,
      values: { type: "rental" | "deposit_hold"; method: "stripe" | "cash"; status: string },
    ) {
      await louezDb.db.insert(louezDb.payments).values({
        id: nextId("pay"),
        reservationId,
        amount: "12.50",
        type: values.type,
        method: values.method,
        status: values.status as "pending",
      });
    }

    test("cancelled with an insurance contract: the fee voided, then the contract cancelled, then the store's message", async () => {
      const { id } = await reservationOf("pending", { tulipContractId: "tulip_contract" });

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        success: true,
      });

      assert.equal((await reservationRow(id)).status, "cancelled");
      assert.deepEqual(await activityOf(id), [cancelledRow]);
      assert.deepEqual(calls, [
        sessionCall,
        ["runReservationEffects", [feeVoidOf(id)]],
        ["cancelTulipContractForReservation", { reservationId: id }],
        await ownerCancellation(id),
        ...cancelRevalidations(id),
      ]);
    });

    test("cancelled without an insurance contract: no call to the insurer", async () => {
      const { id } = await reservationOf("pending");

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        success: true,
      });

      assert.deepEqual(await activityOf(id), [cancelledRow]);
      assert.deepEqual(calls, [
        sessionCall,
        ["runReservationEffects", [feeVoidOf(id)]],
        await ownerCancellation(id),
        ...cancelRevalidations(id),
      ]);
    });

    test("takes the reservation's lock alone, scoped to the store", async () => {
      const { id, productId } = await reservationOf("pending");
      const seen = watchLock(productId);

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        success: true,
      });
      assert.deepEqual(seen, [
        { scope: { reservationId: id, storeId: STORE }, productLocked: false },
      ]);
    });

    test("runs again when it loses a deadlock, and voids the fee once", async () => {
      const { id } = await reservationOf("pending");
      loseDeadlocks(1);

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        success: true,
      });

      assert.equal(hooks.restarts, 1);
      assert.deepEqual(await activityOf(id), [cancelledRow]);
      assert.deepEqual(names(), [
        "getCustomerSession",
        "runReservationEffects",
        "dispatchNotification",
        "revalidatePath",
        "revalidatePath",
        "revalidatePath",
        "revalidatePath",
      ]);
    });

    test("already cancelled, by the store: success, nothing written, an empty fee run, no message", async () => {
      const { id } = await reservationOf("cancelled", { tulipContractId: "tulip_contract" });

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        success: true,
      });

      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [
        sessionCall,
        ["runReservationEffects", []],
        ...cancelRevalidations(id),
      ]);
    });

    test("asked by its id in another case: the pages refreshed are those of the id as stored", async () => {
      const { id } = await reservationOf("pending");
      // The database matches an id whatever its case.
      const asked = id.toUpperCase();
      assert.notEqual(asked, id);

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, asked), {
        success: true,
      });
      assert.deepEqual(calls.slice(-4), cancelRevalidations(id));

      // Asked again, now that it is cancelled: the same pages.
      calls.length = 0;
      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, asked), {
        success: true,
      });
      assert.deepEqual(calls.slice(-4), cancelRevalidations(id));
    });

    test("cancelled between the read and the lock: success, nothing written, no message", async () => {
      const { id } = await reservationOf("pending");
      changeStatusBeforeLock(id, "cancelled");

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        success: true,
      });

      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [
        sessionCall,
        ["runReservationEffects", []],
        ...cancelRevalidations(id),
      ]);
    });

    test("no longer pending: requestCancellationStatusChanged, nothing written or sent", async () => {
      const { id } = await reservationOf("confirmed");

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        error: "requestCancellationStatusChanged",
      });

      assert.equal((await reservationRow(id)).status, "confirmed");
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("confirmed between the read and the lock: requestCancellationStatusChanged", async () => {
      const { id } = await reservationOf("pending");
      changeStatusBeforeLock(id, "confirmed");

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        error: "requestCancellationStatusChanged",
      });

      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a Stripe checkout still pending: requestCancellationPaymentPending, nothing written or sent", async () => {
      const { id } = await reservationOf("pending");
      await paymentOf(id, { type: "rental", method: "stripe", status: "pending" });

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id, true), {
        error: "requestCancellationPaymentPending",
      });

      assert.equal((await reservationRow(id)).status, "pending");
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a deposit hold Stripe has not confirmed is no checkout: cancelled", async () => {
      const { id } = await reservationOf("pending");
      await paymentOf(id, { type: "deposit_hold", method: "stripe", status: "pending" });

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        success: true,
      });

      assert.deepEqual(await activityOf(id), [cancelledRow]);
    });

    for (const status of ["completed", "authorized"]) {
      test(`a payment ${status} and not acknowledged: requestCancellationPaymentChanged, nothing written or sent`, async () => {
        const { id } = await reservationOf("pending");
        await paymentOf(id, { type: "rental", method: "cash", status });

        assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
          error: "requestCancellationPaymentChanged",
        });

        assert.equal((await reservationRow(id)).status, "pending");
        assert.deepEqual(await activityOf(id), []);
        assert.deepEqual(calls, [sessionCall]);
      });
    }

    test("a completed payment acknowledged: cancelled", async () => {
      const { id } = await reservationOf("pending");
      await paymentOf(id, { type: "rental", method: "stripe", status: "completed" });

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id, true), {
        success: true,
      });

      assert.equal((await reservationRow(id)).status, "cancelled");
      assert.deepEqual(await activityOf(id), [cancelledRow]);
      assert.deepEqual(calls, [
        sessionCall,
        ["runReservationEffects", [feeVoidOf(id)]],
        await ownerCancellation(id),
        ...cancelRevalidations(id),
      ]);
    });

    test("busy on each of its three runs: tryAgain, nothing written, nothing else done", async () => {
      const { id } = await reservationOf("pending", { tulipContractId: "tulip_contract" });
      loseDeadlocks(3);

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        error: "tryAgain",
      });

      assert.equal(hooks.restarts, 2);
      assert.equal((await reservationRow(id)).status, "pending");
      assert.deepEqual(await activityOf(id), []);
      assert.deepEqual(calls, [sessionCall]);
    });

    test("another customer's request: reservationNotFound, nothing written or sent", async () => {
      const { id } = await reservationOf("pending", { customerId: OTHER_CUSTOMER });

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        error: "reservationNotFound",
      });

      assert.equal((await reservationRow(id)).status, "pending");
      assert.deepEqual(calls, [sessionCall]);
    });

    test("a second call after a success answers success, and nothing is written or sent again", async () => {
      const { id } = await reservationOf("pending", { tulipContractId: "tulip_contract" });
      await actions.cancelReservationRequest(STORE_SLUG, id);
      calls.length = 0;

      assert.deepEqual(await actions.cancelReservationRequest(STORE_SLUG, id), {
        success: true,
      });

      assert.deepEqual(await activityOf(id), [cancelledRow]);
      assert.deepEqual(calls, [
        sessionCall,
        ["runReservationEffects", []],
        ...cancelRevalidations(id),
      ]);
    });
  });
});
