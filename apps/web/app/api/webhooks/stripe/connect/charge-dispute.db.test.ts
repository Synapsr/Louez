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
});
