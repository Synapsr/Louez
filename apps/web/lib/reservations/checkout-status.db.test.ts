import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";
import { runInNewContext } from "node:vm";

import { eq } from "drizzle-orm";

import type { ReservationBillingEffect, ReservationStatus } from "@louez/db";
import {
  createTestDatabase,
  reservationChangeTestHooks,
  skipWithoutTestDatabase,
  waitForLockWaits,
  type TestDatabase,
} from "@louez/db/testing";

import { fakeDepositStripe } from "./fake-deposit-stripe.fixtures";
import { getCheckoutFailure } from "./util.checkout-failure";

// The checkout's status changes on a migrated database: a paid confirmation,
// its deposit included, a resubmitted cart, an expired payment session and a
// failed one.

// The checkout modules import Next.js-only guards and the file storage SDK.
// Plain Node is already a server, and these tests store no file.
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only" || specifier === "@/lib/storage/files"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
  },
});

const STORE = "store_checkout";
const BEFORE = new Date("2026-01-10T08:00:00Z");

describe("checkout status changes (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let payment: typeof import("./complete-checkout-payment");
  let creation: typeof import("./create-reservation");
  let abandoned: typeof import("./cancel-abandoned-checkout");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("checkout_status");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    payment = await import("./complete-checkout-payment");
    creation = await import("./create-reservation");
    abandoned = await import("./cancel-abandoned-checkout");

    // The inventory check reads the store's settings.
    await louezDb.db
      .insert(louezDb.stores)
      .values({ id: STORE, userId: "owner", name: "Checkout", slug: "checkout-status" });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  async function createReservation(status: ReservationStatus): Promise<string> {
    const id = nextId("chk");
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer",
      number: id,
      status,
      startDate: new Date("2026-02-01T09:00:00Z"),
      endDate: new Date("2026-02-03T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      source: "online",
      createdAt: BEFORE,
      updatedAt: BEFORE,
    });
    return id;
  }

  /** A consumable product with `stock` left, and an unconsumed item of `quantity`. */
  async function addConsumable(
    reservationId: string,
    { stock, quantity }: { stock: number; quantity: number },
  ) {
    const productId = nextId("prd");
    const itemId = nextId("itm");
    await louezDb.db.insert(louezDb.products).values({
      id: productId,
      storeId: STORE,
      name: productId,
      price: "1.00",
      pricingMode: "day",
      stockKind: "consumable",
      quantity: stock,
    });
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: itemId,
      reservationId,
      productId,
      quantity,
      unitPrice: "1.00",
      depositPerUnit: "0.00",
      totalPrice: "1.00",
      productSnapshot: { name: productId, description: null, images: [] },
    });
    return { productId, itemId };
  }

  async function readStock({ productId, itemId }: { productId: string; itemId: string }) {
    const [product] = await louezDb.db
      .select({ quantity: louezDb.products.quantity })
      .from(louezDb.products)
      .where(eq(louezDb.products.id, productId));
    const [item] = await louezDb.db
      .select({ consumed: louezDb.reservationItems.consumedQuantity })
      .from(louezDb.reservationItems)
      .where(eq(louezDb.reservationItems.id, itemId));
    return { stock: product?.quantity, consumed: item?.consumed };
  }

  async function readReservation(id: string) {
    const [row] = await louezDb.db
      .select({
        status: louezDb.reservations.status,
        updatedAt: louezDb.reservations.updatedAt,
        billableAt: louezDb.reservations.billableAt,
        stripeCustomerId: louezDb.reservations.stripeCustomerId,
        stripePaymentMethodId: louezDb.reservations.stripePaymentMethodId,
        depositStatus: louezDb.reservations.depositStatus,
      })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, id));
    return row;
  }

  async function readActivity(id: string) {
    return louezDb.db
      .select({
        activityType: louezDb.reservationActivity.activityType,
        userId: louezDb.reservationActivity.userId,
        metadata: louezDb.reservationActivity.metadata,
      })
      .from(louezDb.reservationActivity)
      .where(eq(louezDb.reservationActivity.reservationId, id))
      .orderBy(louezDb.reservationActivity.createdAt);
  }

  async function addPayment(
    reservationId: string,
    values: {
      status: "pending" | "completed" | "failed" | "cancelled";
      stripeCheckoutSessionId?: string;
    },
  ) {
    const id = nextId("pay");
    await louezDb.db.insert(louezDb.payments).values({
      id,
      reservationId,
      amount: "10.00",
      type: "rental",
      method: "stripe",
      ...values,
    });
    return id;
  }

  async function readPaymentStatus(id: string) {
    const [row] = await louezDb.db
      .select({ status: louezDb.payments.status })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.id, id));
    return row?.status;
  }

  const PAID = {
    stripeCustomerId: "cus_test",
    stripePaymentMethodId: "pm_test",
    depositStatus: "card_saved",
    activityMetadata: {
      source: "online_payment",
      depositAmount: 0,
      depositStatus: "card_saved",
      cardSaved: true,
    },
  } as const;

  const confirmPaid = (reservationId: string) =>
    payment.confirmPaidReservationOrThrow({ reservationId, storeId: STORE, ...PAID });

  /**
   * A product update, which locks the product's row first, with writes behind
   * it, then the product's reservations, racing `confirm`. Before the owner
   * entry, the confirmation took the reservation, then the product, and one of
   * the two lost a deadlock. Now it waits for the product, holding nothing.
   */
  async function raceProductUpdate(id: string, productId: string, confirm: () => Promise<boolean>) {
    const update = await database.connect();
    let confirmed: Promise<unknown> | undefined;
    try {
      await update.beginTransaction();
      await update.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [productId]);
      for (let index = 0; index < 5; index += 1) {
        await update.query(
          "INSERT INTO product_units (id, product_id, identifier) VALUES (?, ?, ?)",
          [nextId("unt"), productId, `PAID-${index}`],
        );
      }
      confirmed = confirm().then(
        (result) => result,
        (error: unknown) => ({ thrown: String(error) }),
      );
      await waitForLockWaits(update, database.name, 1);
      // The reservation is free: the confirmation has not taken it yet.
      await update.query("SELECT id FROM reservations WHERE id = ? FOR UPDATE NOWAIT", [id]);
      await update.rollback();
    } finally {
      await update.end();
    }
    return confirmed;
  }

  test("a paid confirmation waits behind a product update, takes no lock before it, and confirms once", async () => {
    const hooks = reservationChangeTestHooks();
    hooks.restarts = 0;
    const id = await createReservation("pending");
    const item = await addConsumable(id, { stock: 5, quantity: 2 });

    assert.equal(await raceProductUpdate(id, item.productId, () => confirmPaid(id)), true);

    assert.equal(hooks.restarts, 0, "no deadlock: no run started over");
    assert.equal((await readReservation(id))?.status, "confirmed");
    assert.deepEqual(await readStock(item), { stock: 3, consumed: 2 });
    const confirmations = (await readActivity(id)).filter(
      (row) => row.activityType === "confirmed",
    );
    assert.equal(confirmations.length, 1, "one confirmation, recorded once");
  });

  test("the paid confirmation's repair of a confirmed checkout waits behind a product update, then takes its stock", async () => {
    const hooks = reservationChangeTestHooks();
    hooks.restarts = 0;
    const id = await createReservation("confirmed");
    const item = await addConsumable(id, { stock: 5, quantity: 2 });

    assert.equal(await raceProductUpdate(id, item.productId, () => confirmPaid(id)), false);

    assert.equal(hooks.restarts, 0, "no deadlock: no run started over");
    assert.deepEqual(await readStock(item), { stock: 3, consumed: 2 });
  });

  test("a paid pending checkout is confirmed, with its stock and its activity row", async () => {
    const id = await createReservation("pending");
    const item = await addConsumable(id, { stock: 5, quantity: 2 });

    assert.equal(await confirmPaid(id), true);

    const row = await readReservation(id);
    assert.equal(row?.status, "confirmed");
    assert.ok(row?.billableAt, "billable_at is set on confirmation");
    assert.equal(row?.stripeCustomerId, "cus_test");
    assert.equal(row?.stripePaymentMethodId, "pm_test");
    assert.equal(row?.depositStatus, "card_saved");
    assert.deepEqual(await readStock(item), { stock: 3, consumed: 2 });
    assert.deepEqual(await readActivity(id), [
      {
        activityType: "confirmed",
        userId: null,
        metadata: {
          previousStatus: "pending",
          newStatus: "confirmed",
          actor: "payment",
          ...PAID.activityMetadata,
          // The verdict of the stock check it passed.
          overbooked: false,
        },
      },
    ]);
  });

  test("an already confirmed checkout gets its missing stock taken and is not confirmed again", async () => {
    const id = await createReservation("confirmed");
    const item = await addConsumable(id, { stock: 5, quantity: 2 });

    assert.equal(await confirmPaid(id), false);

    assert.deepEqual(await readStock(item), { stock: 3, consumed: 2 });
    assert.deepEqual(await readActivity(id), []);
    // The payment details are only written on a confirmation.
    assert.equal((await readReservation(id))?.stripeCustomerId, null);
  });

  test("a cancelled checkout is left as it is", async () => {
    const id = await createReservation("cancelled");
    const item = await addConsumable(id, { stock: 5, quantity: 2 });

    assert.equal(await confirmPaid(id), false);

    const row = await readReservation(id);
    assert.equal(row?.status, "cancelled");
    assert.deepEqual(row?.updatedAt, BEFORE);
    assert.equal(row?.stripeCustomerId, null);
    assert.deepEqual(await readStock(item), { stock: 5, consumed: 0 });
    assert.deepEqual(await readActivity(id), []);
  });

  test("a consumable that ran out leaves the paid checkout pending, with its payment details", async () => {
    const id = await createReservation("pending");
    const item = await addConsumable(id, { stock: 1, quantity: 2 });

    // By name: under tsx, this file and the app load their own copy of @louez/db.
    await assert.rejects(confirmPaid(id), {
      name: "ConsumableStockError",
      code: "INSUFFICIENT_STOCK",
    });

    const row = await readReservation(id);
    assert.equal(row?.status, "pending");
    assert.equal(row?.billableAt, null);
    assert.equal(row?.stripeCustomerId, "cus_test");
    assert.deepEqual(await readStock(item), { stock: 1, consumed: 0 });
    assert.deepEqual(await readActivity(id), []);
  });

  test("a resubmitted cart cancels the pending checkout and its open payment", async () => {
    const id = await createReservation("pending");
    const open = await addPayment(id, { status: "pending", stripeCheckoutSessionId: "cs_open" });

    const result = await louezDb.runReservationOnlyChange(
      { reservationId: id, storeId: STORE },
      (tx, lock) => creation.supersedePendingCheckout(tx, lock, "replacement"),
    );

    assert.deepEqual(result, {
      sessionIds: ["cs_open"],
      effects: [
        { type: "legacy_fee.void", storeId: STORE, reservationId: id },
      ] satisfies ReservationBillingEffect[],
    });
    assert.equal((await readReservation(id))?.status, "cancelled");
    assert.equal(await readPaymentStatus(open), "cancelled");
    assert.deepEqual(await readActivity(id), [
      {
        activityType: "cancelled",
        userId: null,
        metadata: {
          previousStatus: "pending",
          newStatus: "cancelled",
          actor: "customer",
          reason: "superseded",
          supersededBy: "replacement",
          source: "online",
        },
      },
    ]);
  });

  test("a supersede of a checkout no longer pending rolls back instead of overbooking", async () => {
    const id = await createReservation("confirmed");
    const open = await addPayment(id, { status: "pending", stripeCheckoutSessionId: "cs_kept" });

    await assert.rejects(
      louezDb.runReservationOnlyChange({ reservationId: id, storeId: STORE }, (tx, lock) =>
        creation.supersedePendingCheckout(tx, lock, "replacement"),
      ),
      /unexpected_status/,
    );

    assert.equal((await readReservation(id))?.status, "confirmed");
    assert.equal(await readPaymentStatus(open), "pending");
    assert.deepEqual(await readActivity(id), []);
  });

  // The checkout as the write keeps it; its reservation-only lock is left out.
  const lockResumable = (id: string) =>
    louezDb
      .runReservationTransaction((tx, owner) =>
        creation.lockResumableCheckout(tx, owner, STORE, { id }),
      )
      .then((resumed) => resumed && { id: resumed.id });

  test("a resumed checkout still pending and unpaid is kept for the write", async () => {
    const id = await createReservation("pending");
    await addPayment(id, { status: "pending", stripeCheckoutSessionId: "cs_open" });

    assert.deepEqual(await lockResumable(id), { id });
  });

  test("a resumed checkout paid since it was read becomes a fresh booking", async () => {
    const confirmed = await createReservation("confirmed");
    // Claimed by the webhook, not confirmed yet.
    const claimed = await createReservation("pending");
    await addPayment(claimed, { status: "completed", stripeCheckoutSessionId: "cs_paid" });

    assert.equal(await lockResumable(confirmed), null);
    assert.equal(await lockResumable(claimed), null);
    assert.equal(await lockResumable("missing"), null);
  });

  const expire = (
    reservationId: string,
    run: (effects: readonly ReservationBillingEffect[]) => Promise<void>,
  ) => abandoned.cancelAbandonedCheckout({ reservationId, checkoutSessionId: "cs_expired" }, run);

  test("an expired checkout is cancelled and runs its effects after commit", async () => {
    const id = await createReservation("pending");
    // The webhook cancels the expired session's payment first.
    await addPayment(id, { status: "cancelled", stripeCheckoutSessionId: "cs_expired" });
    const runs: Array<{ effects: readonly ReservationBillingEffect[]; status?: string }> = [];

    const cancelled = await expire(id, async (effects) => {
      // Read on another connection: it sees the cancellation only once committed.
      runs.push({ effects, status: (await readReservation(id))?.status });
    });

    assert.equal(cancelled, true);
    assert.deepEqual(runs, [
      {
        effects: [{ type: "legacy_fee.void", storeId: STORE, reservationId: id }],
        status: "cancelled",
      },
    ]);
    assert.deepEqual(await readActivity(id), [
      {
        activityType: "cancelled",
        userId: null,
        metadata: {
          previousStatus: "pending",
          newStatus: "cancelled",
          actor: "system",
          reason: "payment_expired",
          checkoutSessionId: "cs_expired",
        },
      },
    ]);
  });

  test("an expired checkout with another open or paid payment is left as it is", async () => {
    for (const status of ["pending", "completed"] as const) {
      const id = await createReservation("pending");
      await addPayment(id, { status, stripeCheckoutSessionId: nextId("cs") });
      let runs = 0;

      const cancelled = await expire(id, async () => {
        runs += 1;
      });

      assert.equal(cancelled, false, status);
      assert.equal(runs, 0);
      assert.equal((await readReservation(id))?.status, "pending");
      assert.deepEqual(await readActivity(id), []);
    }
  });

  test("an expired checkout confirmed meanwhile is left as it is", async () => {
    const id = await createReservation("confirmed");
    let runs = 0;

    const cancelled = await expire(id, async () => {
      runs += 1;
    });

    assert.equal(cancelled, false);
    assert.equal(runs, 0);
    assert.equal((await readReservation(id))?.status, "confirmed");
    assert.deepEqual(await readActivity(id), []);
  });

  test("a failed payment session cancels the checkout and runs its effects after commit", async () => {
    const id = await createReservation("pending");
    const eventId = nextId("cal");
    await louezDb.db.insert(louezDb.reservationCalendarEvents).values({
      id: eventId,
      reservationId: id,
      integrationId: "integration",
      syncStatus: "synced",
      attemptCount: 3,
      lastError: "earlier failure",
    });
    const runs: Array<{ effects: readonly ReservationBillingEffect[]; status?: string }> = [];

    const cancelled = await louezDb.cancelFailedCheckoutReservation(
      {
        storeId: STORE,
        reservationId: id,
        reason: "amount_too_small",
        minimumAmount: 0.5,
        currency: "EUR",
      },
      async (effects) => {
        // Read on another connection: it sees the cancellation only once committed.
        runs.push({ effects, status: (await readReservation(id))?.status });
      },
    );

    assert.equal(cancelled, true);
    assert.deepEqual(runs, [
      {
        effects: [{ type: "legacy_fee.void", storeId: STORE, reservationId: id }],
        status: "cancelled",
      },
    ]);
    const failure = {
      source: "checkout_payment_failed",
      reason: "amount_too_small",
      minimumAmount: 0.5,
      currency: "EUR",
    };
    // Both rows usually share one second, so their order is not asserted.
    const activity = await readActivity(id);
    const byType = new Map(activity.map((row) => [row.activityType, row.metadata]));
    assert.equal(activity.length, 2);
    assert.deepEqual(byType.get("payment_failed"), failure);
    assert.deepEqual(byType.get("cancelled"), {
      previousStatus: "pending",
      newStatus: "cancelled",
      actor: "system",
      ...failure,
    });
    // The storefront still explains why the checkout was cancelled.
    assert.deepEqual(getCheckoutFailure("cancelled", activity), failure);

    const [event] = await louezDb.db
      .select({
        syncStatus: louezDb.reservationCalendarEvents.syncStatus,
        attemptCount: louezDb.reservationCalendarEvents.attemptCount,
        lastError: louezDb.reservationCalendarEvents.lastError,
      })
      .from(louezDb.reservationCalendarEvents)
      .where(eq(louezDb.reservationCalendarEvents.id, eventId));
    assert.deepEqual(event, { syncStatus: "pending", attemptCount: 0, lastError: null });
  });

  test("a failed payment session leaves a checkout with a payment row as it is", async () => {
    const id = await createReservation("pending");
    await addPayment(id, { status: "failed" });
    let runs = 0;

    const cancelled = await louezDb.cancelFailedCheckoutReservation(
      { storeId: STORE, reservationId: id, reason: "session_creation_failed" },
      async () => {
        runs += 1;
      },
    );

    assert.equal(cancelled, false);
    assert.equal(runs, 0);
    assert.equal((await readReservation(id))?.status, "pending");
    assert.deepEqual(await readActivity(id), []);
  });
  test("a failed payment session whose cancellation stays busy answers and logs as a lost deadlock did", async () => {
    const id = await createReservation("pending");
    const hooks = reservationChangeTestHooks();
    let runs = 0;
    hooks.beforeReservationLock = async () => {
      runs += 1;
      throw Object.assign(new Error("Deadlock found when trying to get lock"), {
        code: "ER_LOCK_DEADLOCK",
        errno: 1213,
      });
    };

    // The checkout's interactive path, its session failed: the real cancellation,
    // the rest replaced. Before the owner entry, the lost deadlock propagated
    // there, was logged, and the checkout answered errors.createReservationError.
    const source = readFileSync(new URL("./create-reservation.ts", import.meta.url), "utf8");
    const stripTypes: (code: string) => string = Reflect.get(nodeModule, "stripTypeScriptTypes");
    const compiled = stripTypes(
      source.slice(source.indexOf("export const createReservation =")).replace("export ", ""),
    );
    const logged: unknown[][] = [];
    const effects: unknown[] = [];
    const store = { id: STORE, slug: "checkout-status", settings: { currency: "EUR" } };
    const checkout = runInNewContext(`${compiled}; createReservation`, {
      checkMarketplaceCapability: async () => null,
      prepareReservation: async () => ({
        ok: true,
        prepared: {
          store,
          totals: { total: 10 },
          insurance: { amount: 0, appliedOptIn: false },
          promo: null,
          delivery: {},
          cart: { lines: [] },
          window: { start: new Date(), end: new Date() },
          customerPhone: null,
        },
      }),
      checkReservationGate: async () => ({ accepts: true }),
      getEffectiveReservationMode: () => "payment",
      getCheckoutChargeAmount: () => ({ finalChargeAmount: 10 }),
      validateStripePaymentAmount: () => ({ ok: true }),
      writeReservation: async () => ({
        ok: true,
        replay: false,
        reused: false,
        reservationId: id,
        reservationNumber: id,
        customerId: "customer",
        customerEmail: "guest@example.test",
        currency: "EUR",
      }),
      runPostCreationEffects: async () => {},
      startCheckoutPayment: async () => null,
      cancelFailedCheckoutReservation: louezDb.cancelFailedCheckoutReservation,
      runReservationEffects: async (ran: unknown) => {
        effects.push(ran);
      },
      failReservation: (error: string, params?: unknown) => ({ ok: false, error, params }),
      describeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
      log: {
        error: (...args: unknown[]) => {
          logged.push(args);
        },
      },
    });

    let result: unknown;
    try {
      result = await checkout({
        source: "online",
        items: [{ quantity: 1 }],
        customer: { email: "guest@example.test", firstName: "Test", lastName: "Guest" },
      });
    } finally {
      hooks.beforeReservationLock = null;
    }

    assert.deepEqual(result, {
      ok: false,
      error: "errors.createReservationError",
      params: undefined,
    });
    assert.equal(runs, 3, "three runs of the owner entry");
    assert.equal(logged.length, 1);
    assert.equal(logged[0]?.[0], "reservation");
    assert.match(String(logged[0]?.[1]), /^creation failed: /);
    assert.deepEqual(effects, []);
    assert.equal((await readReservation(id))?.status, "pending");
    assert.deepEqual(await readActivity(id), []);
  });

  // Slice 6a-1: the paid confirmation never rewrites the deposit of a reservation on
  // which funds are held or were taken. The state table writes its rows directly; the
  // interleavings settle their holds through the hold writer itself
  // (`settleDepositIntent`), from PaymentIntents a fake Stripe makes.
  describe("a deposit on which funds are held or were taken", () => {
    const DEPOSIT_STORE = "store_chk_deposit";
    const ACCOUNT = "acct_checkout_deposit";
    let holdWrites: typeof import("./deposit-hold-writes");
    let hold: typeof import("./deposit-hold");
    let completion: typeof import("@/lib/stripe/payment-completion");

    before(async () => {
      holdWrites = await import("./deposit-hold-writes");
      hold = await import("./deposit-hold");
      completion = await import("@/lib/stripe/payment-completion");
      // A connected account: the hold writer binds a PaymentIntent to the store's.
      await louezDb.db.insert(louezDb.stores).values({
        id: DEPOSIT_STORE,
        userId: "owner",
        name: "Checkout deposit",
        slug: "checkout-deposit",
        stripeAccountId: ACCOUNT,
      });
    });

    type DepositColumn = NonNullable<
      (typeof louezDb.reservations)["$inferInsert"]["depositStatus"]
    >;

    /** A pending checkout with a deposit of 50, its deposit columns as given. */
    async function pendingWithDeposit(
      values: {
        depositStatus?: DepositColumn | null;
        depositPaymentIntentId?: string | null;
        stripeCustomerId?: string | null;
        stripePaymentMethodId?: string | null;
      } = {},
    ): Promise<string> {
      const id = nextId("dep");
      // A fixture, so its deposit may be in any state.
      await louezDb.db.insert(louezDb.reservations).values({
        id,
        storeId: DEPOSIT_STORE,
        customerId: "customer",
        number: id,
        status: "pending",
        startDate: new Date("2026-02-01T09:00:00Z"),
        endDate: new Date("2026-02-03T09:00:00Z"),
        subtotalAmount: "10.00",
        depositAmount: "50.00",
        totalAmount: "10.00",
        source: "online",
        depositStatus: values.depositStatus === undefined ? "pending" : values.depositStatus,
        depositPaymentIntentId: values.depositPaymentIntentId ?? null,
        stripeCustomerId: values.stripeCustomerId ?? null,
        stripePaymentMethodId: values.stripePaymentMethodId ?? null,
        createdAt: BEFORE,
        updatedAt: BEFORE,
      });
      return id;
    }

    /** A `deposit_hold` row in `status`, on its own PaymentIntent and the hold's card. */
    async function addHoldRow(
      reservationId: string,
      status: "pending" | "authorized" | "completed" | "failed" | "cancelled",
      options: { releaseOwed?: boolean } = {},
    ) {
      const id = nextId("hld");
      await louezDb.db.insert(louezDb.payments).values({
        id,
        reservationId,
        amount: "50.00",
        currency: "EUR",
        type: "deposit_hold",
        method: "stripe",
        status,
        stripePaymentIntentId: `pi_${id}`,
        stripePaymentMethodId: "pm_hold",
        stripeAccountId: ACCOUNT,
        releaseOwedAt: options.releaseOwed ? BEFORE : null,
      });
      return `pi_${id}`;
    }

    /** A product of `stock` consumables on the reservation, one unconsumed item of `quantity`. */
    async function addDepositConsumable(
      reservationId: string,
      { stock, quantity }: { stock: number; quantity: number },
    ) {
      const productId = nextId("prd");
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId: DEPOSIT_STORE,
        name: productId,
        price: "1.00",
        pricingMode: "day",
        stockKind: "consumable",
        quantity: stock,
      });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: nextId("itm"),
        reservationId,
        productId,
        quantity,
        unitPrice: "1.00",
        depositPerUnit: "0.00",
        totalPrice: "1.00",
        productSnapshot: { name: productId, description: null, images: [] },
      });
      return productId;
    }

    /** A tracked product of one unit, which the reservation's line holds. */
    async function addHeldUnit(reservationId: string) {
      const productId = nextId("prd");
      const unitId = nextId("unt");
      const itemId = nextId("itm");
      await louezDb.db.insert(louezDb.products).values({
        id: productId,
        storeId: DEPOSIT_STORE,
        name: productId,
        price: "1.00",
        pricingMode: "day",
        trackUnits: true,
        quantity: 1,
      });
      await louezDb.db
        .insert(louezDb.productUnits)
        .values({ id: unitId, productId, identifier: `UNIT-${unitId}` });
      await louezDb.db.insert(louezDb.reservationItems).values({
        id: itemId,
        reservationId,
        productId,
        quantity: 1,
        unitPrice: "1.00",
        depositPerUnit: "0.00",
        totalPrice: "1.00",
        productSnapshot: { name: productId, description: null, images: [] },
      });
      await louezDb.db.insert(louezDb.reservationItemUnits).values({
        id: nextId("asg"),
        reservationItemId: itemId,
        productUnitId: unitId,
        identifierSnapshot: `UNIT-${unitId}`,
      });
      return unitId;
    }

    async function readDeposit(id: string) {
      const r = louezDb.reservations;
      const [row] = await louezDb.db
        .select({
          status: r.status,
          depositStatus: r.depositStatus,
          depositPaymentIntentId: r.depositPaymentIntentId,
          stripeCustomerId: r.stripeCustomerId,
          stripePaymentMethodId: r.stripePaymentMethodId,
        })
        .from(r)
        .where(eq(r.id, id));
      return row;
    }

    /** The metadata of the reservation's `confirmed` rows. */
    async function confirmedRows(id: string) {
      return (await readActivity(id))
        .filter((row) => row.activityType === "confirmed")
        .map((row) => row.metadata ?? {});
    }

    /** The session saved a card: `card_saved`, with the checkout's customer and card. */
    const confirmDeposit = (reservationId: string) =>
      payment.confirmPaidReservationOrThrow({
        reservationId,
        storeId: DEPOSIT_STORE,
        ...PAID,
        activityMetadata: { ...PAID.activityMetadata, depositAmount: 50 },
      });

    /** What the Connect webhook writes for a PaymentIntent as the fake Stripe has it now. */
    async function settle(
      reservationId: string,
      stripe: ReturnType<typeof fakeDepositStripe>,
      paymentIntentId: string,
    ) {
      const settled = await holdWrites.settleDepositIntent(louezDb.db, {
        reservationId,
        accountId: ACCOUNT,
        intent: stripe.toIntent(stripe.intentOf(ACCOUNT, paymentIntentId)),
        actorUserId: null,
      });
      assert.equal(settled.status, "settled", JSON.stringify(settled));
      return settled.status === "settled" ? settled.outcome : null;
    }

    /** The customer authorizes the deposit on the storefront, and the webhook records it. */
    async function customerAuthorizes(
      reservationId: string,
      stripe: ReturnType<typeof fakeDepositStripe>,
    ) {
      const intent = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId });
      assert.equal(await settle(reservationId, stripe, intent.id), "authorized");
      return intent;
    }

    describe("the state table, on a pending reservation", () => {
      const LEDGERS = [
        { ledger: "no hold row", row: null },
        { ledger: "a row authorized", row: "authorized" },
        { ledger: "a row authorized, its release owed", row: "release_owed" },
        { ledger: "a row completed", row: "completed" },
        { ledger: "a row pending", row: "pending" },
        { ledger: "a row failed", row: "failed" },
        { ledger: "a row cancelled", row: "cancelled" },
      ] as const;
      const STATUSES = [
        null,
        "none",
        "pending",
        "card_saved",
        "authorized",
        "captured",
        "released",
        "failed",
      ] as const;
      const holdsFunds = (row: (typeof LEDGERS)[number]["row"]) =>
        row === "authorized" || row === "release_owed" || row === "completed";

      for (const depositStatus of STATUSES) {
        for (const { ledger, row } of LEDGERS) {
          const keeps =
            depositStatus === "authorized" || depositStatus === "captured" || holdsFunds(row);
          test(`${depositStatus ?? "null"} with ${ledger}: ${keeps ? "kept" : "written"}`, async () => {
            const stored = {
              depositStatus,
              depositPaymentIntentId: "pi_stored",
              stripeCustomerId: "cus_stored",
              stripePaymentMethodId: "pm_stored",
            };
            const id = await pendingWithDeposit(stored);
            if (row) {
              await addHoldRow(id, row === "release_owed" ? "authorized" : row, {
                releaseOwed: row === "release_owed",
              });
            }

            assert.equal(await confirmDeposit(id), true);

            assert.deepEqual(
              await readDeposit(id),
              keeps
                ? { status: "confirmed", ...stored }
                : {
                    status: "confirmed",
                    depositStatus: "card_saved",
                    // The confirmation never writes the PaymentIntent.
                    depositPaymentIntentId: "pi_stored",
                    stripeCustomerId: "cus_test",
                    stripePaymentMethodId: "pm_test",
                  },
            );
            const [confirmed, ...more] = await confirmedRows(id);
            assert.equal(more.length, 0);
            // The session's facts stay what it gave; the deposit left says so.
            assert.equal(confirmed?.depositStatus, "card_saved");
            if (keeps) assert.equal(confirmed?.depositStatusKept, depositStatus);
            else assert.ok(!("depositStatusKept" in (confirmed ?? {})));
          });
        }
      }
    });

    test("a hold authorized before the payment details are written is left", async () => {
      const stripe = fakeDepositStripe();
      const id = await pendingWithDeposit();
      const held = await customerAuthorizes(id, stripe);

      assert.equal(await confirmDeposit(id), true);

      assert.deepEqual(await readDeposit(id), {
        status: "confirmed",
        depositStatus: "authorized",
        depositPaymentIntentId: held.id,
        stripeCustomerId: null,
        stripePaymentMethodId: "pm_customer",
      });
      assert.equal((await confirmedRows(id))[0]?.depositStatusKept, "authorized");
    });

    test("a hold authorized after the payment details, before the status transaction, is left", async () => {
      const stripe = fakeDepositStripe();
      const id = await pendingWithDeposit();
      const productId = await addDepositConsumable(id, { stock: 5, quantity: 1 });

      // The status transaction waits for the product, after the payment details
      // committed: the hold writer locks the reservation, free, meanwhile.
      const products = await database.connect();
      let confirmed: Promise<unknown> | undefined;
      let held: { id: string } | undefined;
      try {
        await products.beginTransaction();
        await products.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [productId]);
        confirmed = confirmDeposit(id).then(
          (result) => result,
          (error: unknown) => ({ thrown: String(error) }),
        );
        await waitForLockWaits(products, database.name, 1);
        assert.equal((await readDeposit(id))?.depositStatus, "card_saved", "the details first");
        held = await customerAuthorizes(id, stripe);
        await products.rollback();
      } finally {
        await products.end();
      }

      assert.equal(await confirmed, true);
      assert.deepEqual(await readDeposit(id), {
        status: "confirmed",
        depositStatus: "authorized",
        depositPaymentIntentId: held?.id,
        // Written with the details, before the hold: the hold writer writes no customer.
        stripeCustomerId: "cus_test",
        stripePaymentMethodId: "pm_customer",
      });
      assert.equal((await confirmedRows(id))[0]?.depositStatusKept, "authorized");
    });

    test("a hold that waits behind the status transaction is written after it", async () => {
      const stripe = fakeDepositStripe();
      const id = await pendingWithDeposit();
      const unitId = await addHeldUnit(id);

      // The status transaction holds the reservation while it waits for its unit; the
      // hold writer then waits for the reservation.
      const units = await database.connect();
      let confirmed: Promise<unknown> | undefined;
      let settled: Promise<unknown> | undefined;
      const intent = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId: id });
      try {
        await units.beginTransaction();
        await units.query("SELECT id FROM product_units WHERE id = ? FOR UPDATE", [unitId]);
        confirmed = confirmDeposit(id).then(
          (result) => result,
          (error: unknown) => ({ thrown: String(error) }),
        );
        await waitForLockWaits(units, database.name, 1);
        settled = settle(id, stripe, intent.id).then(
          (outcome) => outcome,
          (error: unknown) => ({ thrown: String(error) }),
        );
        await waitForLockWaits(units, database.name, 2);
        await units.rollback();
      } finally {
        await units.end();
      }

      assert.equal(await confirmed, true);
      assert.equal(await settled, "authorized");
      assert.deepEqual(await readDeposit(id), {
        status: "confirmed",
        depositStatus: "authorized",
        depositPaymentIntentId: intent.id,
        stripeCustomerId: "cus_test",
        stripePaymentMethodId: "pm_customer",
      });
      assert.ok(!("depositStatusKept" in ((await confirmedRows(id))[0] ?? {})));
    });

    test("a completion run again over the card_saved an older one wrote over a hold writes nothing of the deposit, and confirms", async () => {
      const stripe = fakeDepositStripe();
      const id = await pendingWithDeposit();
      const productId = await addDepositConsumable(id, { stock: 0, quantity: 1 });
      const held = await customerAuthorizes(id, stripe);
      // What a completion before this slice left: its details over the hold, then a
      // stock refusal.
      await louezDb.db
        .update(louezDb.reservations)
        .set({
          depositStatus: "card_saved",
          stripeCustomerId: "cus_older",
          stripePaymentMethodId: "pm_older",
        })
        .where(eq(louezDb.reservations.id, id));
      // The store restocks, and Stripe sends the event again.
      await louezDb.db
        .update(louezDb.products)
        .set({ quantity: 5 })
        .where(eq(louezDb.products.id, productId));

      assert.equal(await confirmDeposit(id), true);

      assert.deepEqual(await readDeposit(id), {
        status: "confirmed",
        depositStatus: "card_saved",
        depositPaymentIntentId: held.id,
        stripeCustomerId: "cus_older",
        stripePaymentMethodId: "pm_older",
      });
      assert.equal((await confirmedRows(id))[0]?.depositStatusKept, "card_saved");
    });

    for (const stored of [null, "pm_unrelated"]) {
      test(`a capture recorded before any authorization is left, with the card stored (${stored ?? "none"})`, async () => {
        const stripe = fakeDepositStripe();
        const id = await pendingWithDeposit({ stripePaymentMethodId: stored });
        const intent = stripe.customerAuthorizes({ accountId: ACCOUNT, reservationId: id });
        stripe.captureAtStripe(ACCOUNT, intent.id);
        assert.equal(await settle(id, stripe, intent.id), "captured");

        assert.equal(await confirmDeposit(id), true);

        assert.deepEqual(await readDeposit(id), {
          status: "confirmed",
          depositStatus: "captured",
          depositPaymentIntentId: intent.id,
          stripeCustomerId: null,
          stripePaymentMethodId: stored,
        });
        assert.equal((await confirmedRows(id))[0]?.depositStatusKept, "captured");
      });
    }

    test("a released hold, nothing held any more, gets the new card, so the store can hold it again", async () => {
      const stripe = fakeDepositStripe();
      const id = await pendingWithDeposit();
      const held = await customerAuthorizes(id, stripe);
      stripe.cancel(ACCOUNT, held.id);
      assert.equal(await settle(id, stripe, held.id), "released");

      assert.equal(await confirmDeposit(id), true);

      assert.deepEqual(await readDeposit(id), {
        status: "confirmed",
        depositStatus: "card_saved",
        depositPaymentIntentId: held.id,
        stripeCustomerId: "cus_test",
        stripePaymentMethodId: "pm_test",
      });
      assert.ok(!("depositStatusKept" in ((await confirmedRows(id))[0] ?? {})));
    });

    test("a failed hold, nothing held, gets the new card, so the store can hold it again", async () => {
      const stripe = fakeDepositStripe();
      const id = await pendingWithDeposit();
      const declined = stripe.createIntent({
        accountId: ACCOUNT,
        customerId: null,
        paymentMethodId: "pm_declined",
        amountMinor: 5000,
        currency: "EUR",
        status: "requires_payment_method",
        attemptId: null,
        reservationId: id,
      });
      assert.equal(await settle(id, stripe, declined.id), "failed");
      assert.equal((await readDeposit(id))?.depositStatus, "failed");

      assert.equal(await confirmDeposit(id), true);

      assert.deepEqual(await readDeposit(id), {
        status: "confirmed",
        depositStatus: "card_saved",
        depositPaymentIntentId: null,
        stripeCustomerId: "cus_test",
        stripePaymentMethodId: "pm_test",
      });
    });

    test("a reservation confirmed before its hold is left by any later run", async () => {
      const stripe = fakeDepositStripe();
      const id = await pendingWithDeposit();
      assert.equal(await confirmDeposit(id), true);
      const held = await customerAuthorizes(id, stripe);

      assert.equal(await confirmDeposit(id), false);

      assert.deepEqual(await readDeposit(id), {
        status: "confirmed",
        depositStatus: "authorized",
        depositPaymentIntentId: held.id,
        stripeCustomerId: "cus_test",
        stripePaymentMethodId: "pm_customer",
      });
      assert.equal((await confirmedRows(id)).length, 1);
    });

    test("a consumable refusal with funds held writes nothing of the deposit", async () => {
      const stripe = fakeDepositStripe();
      const id = await pendingWithDeposit();
      await addDepositConsumable(id, { stock: 0, quantity: 1 });
      const held = await customerAuthorizes(id, stripe);

      // By name: under tsx, this file and the app load their own copy of @louez/db.
      await assert.rejects(confirmDeposit(id), { name: "ConsumableStockError" });

      assert.deepEqual(await readDeposit(id), {
        status: "pending",
        depositStatus: "authorized",
        depositPaymentIntentId: held.id,
        stripeCustomerId: null,
        stripePaymentMethodId: "pm_customer",
      });
      assert.deepEqual(await confirmedRows(id), []);
    });

    test("a deposit authorized on a request, then the rental paid: confirmed on the hold, and no second hold is taken", async () => {
      const stripe = fakeDepositStripe();
      // The request comes in, pending; the customer authorizes the deposit on the page
      // the store sent; the webhook records it.
      const id = await pendingWithDeposit();
      const held = await customerAuthorizes(id, stripe);
      // The customer pays the rental request the store sent; the webhook claims the
      // payment, then confirms, as the completion runs them.
      await completion.claimCompletedCheckoutPayment({
        reservationId: id,
        amount: 10,
        currency: "EUR",
        stripeCheckoutSessionId: `cs_${id}`,
        stripePaymentIntentId: `pi_rental_${id}`,
        stripeChargeId: `ch_${id}`,
        stripePaymentMethodId: "pm_test",
        stripeAccountId: ACCOUNT,
        claimedAt: BEFORE,
        paidAt: BEFORE,
        grossMinor: 1000,
        insuranceShareMinor: 0,
        origin: "payment_request",
        paymentRequestId: null,
        feeFacts: null,
      });
      assert.equal(await confirmDeposit(id), true);

      assert.deepEqual(await readDeposit(id), {
        status: "confirmed",
        depositStatus: "authorized",
        depositPaymentIntentId: held.id,
        stripeCustomerId: null,
        stripePaymentMethodId: "pm_customer",
      });
      // The store asks for a hold on the checkout's card: refused before Stripe.
      stripe.saveCard(ACCOUNT, "pm_test", "cus_test");
      const again = await hold.authorizeDepositHold(
        {
          reservationId: id,
          storeId: DEPOSIT_STORE,
          stripeAccountId: ACCOUNT,
          storeSettings: { currency: "EUR" },
          actorUserId: null,
        },
        { database: louezDb.db, stripe: stripe.port, dispatchEffects: () => {} },
      );
      assert.deepEqual(again, { ok: false, error: "errors.stripe.noSavedCard" });
      assert.equal(stripe.calls.length, 0);
    });
  });
});
