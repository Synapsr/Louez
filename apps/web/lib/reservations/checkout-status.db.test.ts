import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import type { ReservationBillingEffect, ReservationStatus } from "@louez/db";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { getCheckoutFailure } from "./util.checkout-failure";

// The checkout's status changes on a migrated database: a paid confirmation,
// a resubmitted cart, an expired payment session and a failed one.

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

    const result = await louezDb.db.transaction((tx) =>
      creation.supersedePendingCheckout(tx, STORE, { id }, "replacement"),
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
      louezDb.db.transaction((tx) =>
        creation.supersedePendingCheckout(tx, STORE, { id }, "replacement"),
      ),
      /unexpected_status/,
    );

    assert.equal((await readReservation(id))?.status, "confirmed");
    assert.equal(await readPaymentStatus(open), "pending");
    assert.deepEqual(await readActivity(id), []);
  });

  const lockResumable = (id: string) =>
    louezDb.db.transaction((tx) => creation.lockResumableCheckout(tx, STORE, { id }));

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
});
