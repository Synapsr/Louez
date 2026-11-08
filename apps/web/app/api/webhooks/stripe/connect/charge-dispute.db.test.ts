import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as nodeModule from "node:module";
import { after, before, describe, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { DisputeEventType, DisputeInput } from "./dispute-facts";
import type { FeeReversalStripe } from "./fee-reversal";

// `charge.dispute.*` on a migrated database (louez-billing docs/api, fees.md §9): the
// events that withdraw or settle funds refund the fee at source, a reinstatement none.

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// The referral analytics import "server-only", which throws outside Next.
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    return nextResolve(specifier, context);
  },
});

const ACCOUNT = "acct_charge_dispute";
// Named locks are server-wide: other suites on the same MySQL must not share them.
const RUN = randomBytes(4).toString("hex");

/** A charge of 10,000 with a fee of 250, disputed in full and the funds withdrawn. */
function fakeStripe() {
  let feeRefunded = 0;
  const calls = { retrieveCharge: 0 };
  const port: FeeReversalStripe = {
    async retrieveCharge(chargeId, accountId) {
      assert.equal(accountId, ACCOUNT);
      calls.retrieveCharge++;
      return {
        id: chargeId,
        amount: 10_000,
        amount_refunded: 0,
        application_fee: `fee_${chargeId}`,
        payment_intent: null,
      };
    },
    async retrieveApplicationFee(feeId) {
      return { id: feeId, amount: 250, amount_refunded: feeRefunded };
    },
    async listDisputes() {
      return [{ id: "dp_disputed", amount: 10_000, status: "needs_response" }];
    },
    async refundApplicationFee(_feeId, amountMinor) {
      feeRefunded += amountMinor;
    },
  };
  return { port, calls, feeRefunded: () => feeRefunded };
}

describe("charge.dispute.* (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let disputes: typeof import("./charge-dispute");

  before(async () => {
    database = await createTestDatabase("charge_dispute");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    disputes = await import("./charge-dispute");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  const dispute = (chargeId: string): DisputeInput => ({
    id: `dp_${chargeId}`,
    amount: 10_000,
    currency: "eur",
    created: 1_790_000_000,
    charge: chargeId,
    payment_intent: null,
    status: "needs_response",
    balance_transactions: [{ amount: -10_000, created: 1_790_000_000 }],
  });

  const handle = (eventType: DisputeEventType, chargeId: string, port: FeeReversalStripe) =>
    disputes.handleChargeDispute(
      {
        eventType,
        dispute: dispute(chargeId),
        eventCreatedAt: new Date(1_790_000_000_000),
        connectedAccountId: ACCOUNT,
      },
      port,
    );

  for (const eventType of [
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.funds_withdrawn",
    "charge.dispute.closed",
  ] as const) {
    test(`${eventType} refunds the fee of the funds withdrawn`, async () => {
      const stripe = fakeStripe();
      await handle(eventType, `ch_${RUN}_${eventType.replaceAll(".", "_")}`, stripe.port);
      assert.equal(stripe.feeRefunded(), 250);
    });
  }

  test("charge.dispute.funds_reinstated restores no fee and reads nothing from Stripe", async () => {
    const stripe = fakeStripe();
    await handle("charge.dispute.funds_reinstated", `ch_${RUN}_reinstated`, stripe.port);
    assert.equal(stripe.calls.retrieveCharge, 0);
    assert.equal(stripe.feeRefunded(), 0);
  });

  describe("the owner's notification", () => {
    const STORE = "store_dispute_notify";
    const RESERVATION = "res_dispute_notify";
    const CHARGE = `ch_${RUN}_notify`;
    const calls: Array<{ reservationId: string; amount: number; currency: string }> = [];
    const scheduled: Array<() => Promise<unknown>> = [];
    const notify = async (input: { reservationId: string; amount: number; currency: string }) => {
      calls.push(input);
    };

    before(async () => {
      const { db } = louezDb;
      await db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner",
        name: "Dispute notify",
        slug: "dispute-notify",
        stripeAccountId: ACCOUNT,
      });
      await db.insert(louezDb.reservations).values({
        id: RESERVATION,
        storeId: STORE,
        customerId: "customer",
        number: "R-DISPUTE",
        status: "confirmed",
        startDate: new Date("2026-10-01T09:00:00Z"),
        endDate: new Date("2026-10-03T09:00:00Z"),
        subtotalAmount: "100.00",
        depositAmount: "0.00",
        totalAmount: "100.00",
      });
      await db.insert(louezDb.payments).values({
        id: "pay_dispute_notify",
        reservationId: RESERVATION,
        amount: "100.00",
        type: "rental",
        method: "stripe",
        status: "completed",
        stripeChargeId: CHARGE,
        grossMinor: 10_000,
        currency: "EUR",
        paidAt: new Date("2026-10-01T09:30:00Z"),
      });
    });

    const handleWithNotify = (eventType: DisputeEventType, input: Partial<DisputeInput> = {}) =>
      disputes.handleChargeDispute(
        {
          eventType,
          dispute: { ...dispute(CHARGE), ...input },
          eventCreatedAt: new Date(1_790_000_000_000),
          connectedAccountId: ACCOUNT,
        },
        fakeStripe().port,
        { notify, schedule: (task) => void scheduled.push(task) },
      );

    test("is sent once, by the first event of the dispute, with the disputed amount", async () => {
      // Stripe does not order events: an update can arrive before the creation.
      await handleWithNotify("charge.dispute.updated");
      await handleWithNotify("charge.dispute.created");
      await handleWithNotify("charge.dispute.funds_withdrawn");

      // Scheduled for after the answer, not sent while the webhook runs.
      assert.equal(scheduled.length, 1);
      assert.deepEqual(calls, []);
      await Promise.all(scheduled.splice(0).map((task) => task()));
      assert.deepEqual(calls, [{ reservationId: RESERVATION, amount: 100, currency: "EUR" }]);
    });

    test("the webhook answers without waiting for the alert and its retries", async () => {
      let started = false;
      const answered = await disputes
        .handleChargeDispute(
          {
            eventType: "charge.dispute.created",
            dispute: { ...dispute(CHARGE), id: `dp_${RUN}_slow` },
            eventCreatedAt: new Date(1_790_000_000_000),
            connectedAccountId: ACCOUNT,
          },
          fakeStripe().port,
          {
            // An alert whose attempts never end.
            notify: () => {
              started = true;
              return new Promise(() => {});
            },
            // As `after` would at the end of the response, without being awaited.
            schedule: (task) => void task(),
          },
        )
        .then(() => "answered");
      assert.equal(answered, "answered");
      assert.equal(started, true);
    });

    test("is not sent for a dispute first seen closed, nor for an unknown payment", async () => {
      calls.length = 0;
      await handleWithNotify("charge.dispute.closed", { id: `dp_${RUN}_closed`, status: "won" });
      await handle("charge.dispute.created", `ch_${RUN}_unknown`, fakeStripe().port);

      assert.deepEqual(scheduled, []);
      assert.deepEqual(calls, []);
    });
  });
});
