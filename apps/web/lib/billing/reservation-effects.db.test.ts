import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import type { ReservationBillingEffect, ReservationStatus } from "@louez/db";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { MARKETPLACE_FEE_CENTS } from "@/lib/pay-as-you-go/marketplace-fee-core";

import type { LegacyFeeEffectDeps } from "./reservation-effects";

// The real runner and fee functions on a migrated database, with the effects that
// changeReservationStatus returns.
process.env.LOUEZ_BILLING = "cloud";

const PAYG_STORE = "store_effects_payg";
const PLAN_STORE = "store_effects_plan";
const FREE_STORE = "store_effects_free";
const FLAT_RATE_CENTS = 123;
/**
 * Late on the last day of January. The fee's month and billable_at must agree:
 * MySQL would round the milliseconds up into February.
 */
const END_OF_JANUARY = new Date("2026-01-31T23:59:59.600Z");

describe("reservation fee effects (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let runner: typeof import("./reservation-effects");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("reservation_effects");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    runner = await import("./reservation-effects");

    // No stores rows: the fee currency falls back to eur.
    const payAsYouGo = {
      billingMode: "pay_as_you_go",
      payAsYouGoConfig: { flatRateCents: FLAT_RATE_CENTS },
      pricingVersion: "payg-ladder-v1",
    } as const;
    await louezDb.db.insert(louezDb.subscriptions).values([
      { id: "sub_effects_payg", storeId: PAYG_STORE, ...payAsYouGo, freeReservationsGranted: 0 },
      { id: "sub_effects_free", storeId: FREE_STORE, ...payAsYouGo, freeReservationsGranted: 1 },
      {
        id: "sub_effects_plan",
        storeId: PLAN_STORE,
        planSlug: "pro",
        billingMode: "subscription",
        payAsYouGoConfig: { flatRateCents: FLAT_RATE_CENTS },
        pricingVersion: "payg-ladder-v1",
      },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  async function createPendingReservation(storeId: string, source: "online" | "marketplace") {
    const id = `res_effects_${++counter}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId,
      customerId: "customer",
      number: id,
      status: "pending",
      startDate: new Date("2026-02-01T09:00:00Z"),
      endDate: new Date("2026-02-03T09:00:00Z"),
      subtotalAmount: "10.00",
      depositAmount: "0.00",
      totalAmount: "10.00",
      source,
    });
    return id;
  }

  /** Commits the change and returns its effects, as a caller would. */
  async function changeStatus(
    storeId: string,
    reservationId: string,
    to: ReservationStatus,
    now?: Date,
  ) {
    const result = await louezDb.db.transaction((tx) =>
      louezDb.changeReservationStatus(tx, {
        reservationId,
        storeId,
        to,
        actor: "store_user",
        actorUserId: null,
        now,
      }),
    );
    if (!result.changed)
      throw new Error(`${reservationId} did not move to ${to}: ${result.reason}`);
    return result.effects;
  }

  /** The real runner, with a log that fails the test on any swallowed error. */
  async function runEffects(
    effects: readonly ReservationBillingEffect[],
    overrides: Partial<LegacyFeeEffectDeps> = {},
  ) {
    const errors: string[] = [];
    await runner.createLegacyFeeEffectRunner({
      ...overrides,
      log: { error: (tag, message) => errors.push(`${tag}: ${message}`), info: () => undefined },
    })(effects);
    assert.deepEqual(errors, [], "the runner logged no failure");
  }

  async function readReservation(reservationId: string) {
    const [row] = await louezDb.db
      .select({ status: louezDb.reservations.status, billableAt: louezDb.reservations.billableAt })
      .from(louezDb.reservations)
      .where(eq(louezDb.reservations.id, reservationId));
    return row;
  }

  function readFees(reservationId: string) {
    const fees = louezDb.platformFees;
    return louezDb.db
      .select({
        dedupKey: fees.dedupKey,
        source: fees.source,
        status: fees.status,
        amountCents: fees.amountCents,
        monthlyIndex: fees.monthlyIndex,
        billingMonth: fees.billingMonth,
      })
      .from(fees)
      .where(eq(fees.reservationId, reservationId))
      .orderBy(fees.dedupKey);
  }

  async function readFeeStatuses(reservationId: string) {
    return (await readFees(reservationId)).map(({ dedupKey, source, status }) => ({
      dedupKey,
      source,
      status,
    }));
  }

  /** The fees without their month, for changes dated now. */
  async function readFeesAnyMonth(reservationId: string) {
    return (await readFees(reservationId)).map(({ billingMonth: _month, ...fee }) => fee);
  }

  test("a confirmation records a manual pending fee in the month of the change", async () => {
    const online = await createPendingReservation(PAYG_STORE, "online");
    const marketplace = await createPendingReservation(PAYG_STORE, "marketplace");

    await runEffects([
      ...(await changeStatus(PAYG_STORE, online, "confirmed", END_OF_JANUARY)),
      ...(await changeStatus(PAYG_STORE, marketplace, "confirmed", END_OF_JANUARY)),
    ]);

    assert.deepEqual(await readFees(online), [
      {
        dedupKey: `res:${online}`,
        source: "manual",
        status: "pending",
        amountCents: FLAT_RATE_CENTS,
        monthlyIndex: 1,
        billingMonth: "2026-01",
      },
    ]);
    assert.deepEqual(await readFees(marketplace), [
      {
        dedupKey: `mkt:${marketplace}`,
        source: "marketplace_manual",
        status: "pending",
        amountCents: MARKETPLACE_FEE_CENTS,
        monthlyIndex: null,
        billingMonth: "2026-01",
      },
      {
        dedupKey: `res:${marketplace}`,
        source: "manual",
        status: "pending",
        amountCents: FLAT_RATE_CENTS,
        monthlyIndex: 2,
        billingMonth: "2026-01",
      },
    ]);
    assert.deepEqual((await readReservation(online))?.billableAt, new Date("2026-01-31T23:59:59Z"));
  });

  test("a store on a plan pays no reservation fee, but a marketplace one still pays reeent", async () => {
    const online = await createPendingReservation(PLAN_STORE, "online");
    const marketplace = await createPendingReservation(PLAN_STORE, "marketplace");

    await runEffects([
      ...(await changeStatus(PLAN_STORE, online, "confirmed", END_OF_JANUARY)),
      ...(await changeStatus(PLAN_STORE, marketplace, "confirmed", END_OF_JANUARY)),
    ]);

    assert.deepEqual(await readFees(online), []);
    assert.deepEqual(await readFees(marketplace), [
      {
        dedupKey: `mkt:${marketplace}`,
        source: "marketplace_manual",
        status: "pending",
        amountCents: MARKETPLACE_FEE_CENTS,
        monthlyIndex: null,
        billingMonth: "2026-01",
      },
    ]);
  });

  test("a record that runs after the cancellation that followed it writes nothing", async () => {
    const id = await createPendingReservation(PAYG_STORE, "marketplace");
    const confirmation = await changeStatus(PAYG_STORE, id, "confirmed");
    const cancellation = await changeStatus(PAYG_STORE, id, "cancelled");

    // The cancellation's void finds nothing, then the late record re-reads the status.
    await runEffects(cancellation);
    await runEffects(confirmation);

    assert.deepEqual(await readFees(id), []);
  });

  test("a cancellation that commits between the status read and the insert still voids the fees", async () => {
    const id = await createPendingReservation(PAYG_STORE, "marketplace");
    const confirmation = await changeStatus(PAYG_STORE, id, "confirmed");

    let reads = 0;
    await runEffects(confirmation, {
      // The first read sees the confirmation. Then, before the insert, the
      // cancellation commits and its void runs, and finds nothing yet.
      readReservationStatus: async (reservationId, storeId) => {
        const status = (await readReservation(reservationId))?.status ?? null;
        if (++reads === 1)
          await runEffects(await changeStatus(storeId, reservationId, "cancelled"));
        return status;
      },
    });

    assert.equal(reads, 2, "the runner reads the status again after recording");
    assert.equal((await readReservation(id))?.status, "cancelled");
    assert.deepEqual(await readFeeStatuses(id), [
      { dedupKey: `mkt:${id}`, source: "marketplace_manual", status: "voided" },
      { dedupKey: `res:${id}`, source: "manual", status: "voided" },
    ]);
  });

  test("a cancellation voids both fees", async () => {
    const id = await createPendingReservation(PAYG_STORE, "marketplace");
    await runEffects(await changeStatus(PAYG_STORE, id, "confirmed"));
    assert.equal((await readFees(id)).length, 2);

    await runner.runReservationEffects(await changeStatus(PAYG_STORE, id, "cancelled"));

    assert.deepEqual(await readFeeStatuses(id), [
      { dedupKey: `mkt:${id}`, source: "marketplace_manual", status: "voided" },
      { dedupKey: `res:${id}`, source: "manual", status: "voided" },
    ]);
  });

  test("a free reservation credit is used on confirmation and given back on cancellation", async () => {
    const free = { source: "free", status: "collected", amountCents: 0, monthlyIndex: null };
    const confirmFree = async () => {
      const id = await createPendingReservation(FREE_STORE, "online");
      await runEffects(await changeStatus(FREE_STORE, id, "confirmed"));
      return id;
    };

    const first = await confirmFree();
    assert.deepEqual(await readFeesAnyMonth(first), [{ dedupKey: `res:${first}`, ...free }]);

    await runEffects(await changeStatus(FREE_STORE, first, "cancelled"));
    assert.deepEqual(await readFeeStatuses(first), [
      { dedupKey: `res:${first}`, source: "free", status: "voided" },
    ]);

    // A late record after its cancellation writes nothing, so it uses no credit.
    const late = await createPendingReservation(FREE_STORE, "online");
    const confirmation = await changeStatus(FREE_STORE, late, "confirmed");
    await runEffects(await changeStatus(FREE_STORE, late, "cancelled"));
    await runEffects(confirmation);
    assert.deepEqual(await readFees(late), []);

    const next = await confirmFree();
    assert.deepEqual(await readFeesAnyMonth(next), [{ dedupKey: `res:${next}`, ...free }]);

    // The credit is used now: the next rental pays.
    const paid = await confirmFree();
    assert.deepEqual(await readFeesAnyMonth(paid), [
      {
        dedupKey: `res:${paid}`,
        source: "manual",
        status: "pending",
        amountCents: FLAT_RATE_CENTS,
        monthlyIndex: 1,
      },
    ]);
  });

  test("with billing off, nothing is written", async () => {
    const id = await createPendingReservation(PAYG_STORE, "marketplace");
    const confirmation = await changeStatus(PAYG_STORE, id, "confirmed");

    process.env.LOUEZ_BILLING = "off";
    try {
      await runEffects(confirmation);
    } finally {
      process.env.LOUEZ_BILLING = "cloud";
    }

    assert.deepEqual(await readFees(id), []);
  });
});
