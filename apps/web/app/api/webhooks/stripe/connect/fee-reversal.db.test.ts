import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { FeeReversalStripe } from "./fee-reversal";

// The fee refund at source (louez-billing docs/api, fees.md §9) on a migrated database,
// against a fake Stripe that keeps the fee's refunded amount as Stripe would.

const STORE = "store_fee_reversal";
const ACCOUNT = "acct_fee_reversal";
// Named locks are server-wide: other suites on the same MySQL must not share them.
const RUN = randomBytes(4).toString("hex");

type FakeCharge = {
  amount: number;
  amountRefunded: number;
  feeId: string | null;
  paymentIntentId: string;
  disputes: Array<{ id: string; amount: number; status: string }>;
};

/** One connected account's charges and the platform's fees. */
function fakeStripe() {
  const charges = new Map<string, FakeCharge>();
  const fees = new Map<string, { amount: number; amountRefunded: number }>();
  const refunds: Array<{ feeId: string; amount: number; key: string }> = [];
  const keys = new Set<string>();
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
  const port: FeeReversalStripe = {
    async retrieveCharge(chargeId, accountId) {
      assert.equal(accountId, ACCOUNT);
      const charge = charges.get(chargeId);
      if (!charge) throw new Error(`no such charge: ${chargeId}`);
      await pause();
      return {
        id: chargeId,
        amount: charge.amount,
        amount_refunded: charge.amountRefunded,
        application_fee: charge.feeId,
        payment_intent: charge.paymentIntentId,
      };
    },
    async retrieveApplicationFee(feeId) {
      const fee = fees.get(feeId);
      if (!fee) throw new Error(`no such fee: ${feeId}`);
      await pause();
      return { id: feeId, amount: fee.amount, amount_refunded: fee.amountRefunded };
    },
    async listDisputes(chargeId) {
      return charges.get(chargeId)?.disputes ?? [];
    },
    async refundApplicationFee(feeId, amountMinor, idempotencyKey) {
      const fee = fees.get(feeId);
      if (!fee) throw new Error(`no such fee: ${feeId}`);
      if (keys.has(idempotencyKey)) return;
      if (fee.amountRefunded + amountMinor > fee.amount)
        throw new Error("Refund amount is greater than the remaining application fee");
      keys.add(idempotencyKey);
      fee.amountRefunded += amountMinor;
      refunds.push({ feeId, amount: amountMinor, key: idempotencyKey });
    },
  };
  return { port, charges, fees, refunds };
}

describe("fee refund at source (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let reversal: typeof import("./fee-reversal");
  let counter = 0;
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("fee_reversal");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    reversal = await import("./fee-reversal");
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://localhost:3100";
  });

  afterEach(() => {
    for (const [name, value] of [
      ["LOUEZ_BILLING", env.billing],
      ["BILLING_SERVICE_URL", env.url],
    ] satisfies Array<[string, string | undefined]>) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  /** A charge with an application fee, and the legacy `res:` row Stripe took it for. */
  async function chargeWithFee(
    stripe: ReturnType<typeof fakeStripe>,
    charge: { amount: number; fee: number; disputes?: FakeCharge["disputes"] },
  ) {
    const n = ++counter;
    const chargeId = `ch_${RUN}_${n}`;
    const feeId = `fee_${RUN}_${n}`;
    const paymentIntentId = `pi_${RUN}_${n}`;
    const reservationId = `res_fee_reversal_${n}`;
    stripe.charges.set(chargeId, {
      amount: charge.amount,
      amountRefunded: 0,
      feeId,
      paymentIntentId,
      disputes: charge.disputes ?? [],
    });
    stripe.fees.set(feeId, { amount: charge.fee, amountRefunded: 0 });
    await louezDb.db.insert(louezDb.platformFees).values({
      id: `fee_row_${n}`,
      storeId: STORE,
      reservationId,
      dedupKey: `res:${reservationId}`,
      amountCents: charge.fee,
      currency: "eur",
      source: "online",
      status: "collected",
      billingMonth: "2026-10",
      monthlyIndex: 1,
      stripePaymentIntentId: paymentIntentId,
      stripeApplicationFeeId: feeId,
    });
    return { chargeId, feeId, rowId: `fee_row_${n}` };
  }

  const readRow = async (id: string) => {
    const [row] = await louezDb.db
      .select({
        status: louezDb.platformFees.status,
        reversed: louezDb.platformFees.amountReversedCents,
      })
      .from(louezDb.platformFees)
      .where(eq(louezDb.platformFees.id, id));
    return row;
  };

  test("partial refunds give back a cumulative share of the fee, recorded on the row", async () => {
    const stripe = fakeStripe();
    const { chargeId, feeId, rowId } = await chargeWithFee(stripe, { amount: 10_000, fee: 250 });
    const charge = stripe.charges.get(chargeId);
    assert.ok(charge);

    // reversal-02, then reversal-03.
    charge.amountRefunded = 3_333;
    const first = await reversal.reverseFeeAtSource({
      chargeId,
      accountId: ACCOUNT,
      stripe: stripe.port,
    });
    assert.deepEqual(first, { status: "refunded", feeId, targetMinor: 83, incrementMinor: 83 });
    charge.amountRefunded = 6_666;
    await reversal.reverseFeeAtSource({ chargeId, accountId: ACCOUNT, stripe: stripe.port });
    assert.deepEqual(stripe.refunds, [
      { feeId, amount: 83, key: `appfee_reverse_${feeId}_0_83` },
      { feeId, amount: 84, key: `appfee_reverse_${feeId}_83_167` },
    ]);
    assert.deepEqual(await readRow(rowId), { status: "collected", reversed: 167 });

    // The same event again: nothing left to refund, nothing changes.
    const again = await reversal.reverseFeeAtSource({
      chargeId,
      accountId: ACCOUNT,
      stripe: stripe.port,
    });
    assert.deepEqual(again, { status: "unchanged", feeId, targetMinor: 167, incrementMinor: 0 });
    assert.equal(stripe.refunds.length, 2);
  });

  test("two deliveries at once refund the fee once", async () => {
    const stripe = fakeStripe();
    const { chargeId, feeId, rowId } = await chargeWithFee(stripe, { amount: 15_000, fee: 375 });
    const charge = stripe.charges.get(chargeId);
    assert.ok(charge);
    charge.amountRefunded = 15_000;

    const results = await Promise.all([
      reversal.reverseFeeAtSource({ chargeId, accountId: ACCOUNT, stripe: stripe.port }),
      reversal.reverseFeeAtSource({ chargeId, accountId: ACCOUNT, stripe: stripe.port }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), ["refunded", "unchanged"]);
    assert.deepEqual(stripe.refunds, [
      { feeId, amount: 375, key: `appfee_reverse_${feeId}_0_375` },
    ]);
    assert.deepEqual(await readRow(rowId), { status: "reversed", reversed: 375 });
  });

  test("only disputes whose funds Stripe withdrew count, and a won one stops counting", async () => {
    const stripe = fakeStripe();
    const { chargeId, feeId } = await chargeWithFee(stripe, {
      amount: 25_000,
      fee: 625,
      disputes: [
        { id: "dp_inquiry", amount: 25_000, status: "warning_needs_response" },
        { id: "dp_prevented", amount: 25_000, status: "prevented" },
      ],
    });
    const charge = stripe.charges.get(chargeId);
    assert.ok(charge);
    const reverse = () =>
      reversal.reverseFeeAtSource({ chargeId, accountId: ACCOUNT, stripe: stripe.port });

    assert.equal((await reverse()).status, "unchanged");
    assert.deepEqual(stripe.refunds, []);

    // The inquiry became a chargeback on 10,000 of the 25,000.
    charge.disputes = [{ id: "dp_inquiry", amount: 10_000, status: "needs_response" }];
    await reverse();
    // Won: the fee at source is not restored, and nothing more is refunded.
    charge.disputes = [{ id: "dp_inquiry", amount: 10_000, status: "won" }];
    await reverse();
    // A later refund of the whole charge brings the target to the whole fee.
    charge.amountRefunded = 25_000;
    await reverse();
    assert.deepEqual(stripe.refunds, [
      { feeId, amount: 250, key: `appfee_reverse_${feeId}_0_250` },
      { feeId, amount: 375, key: `appfee_reverse_${feeId}_250_625` },
    ]);
  });

  test("a status Louez does not know counts", async () => {
    const stripe = fakeStripe();
    const { chargeId, feeId } = await chargeWithFee(stripe, {
      amount: 25_000,
      fee: 625,
      disputes: [{ id: "dp_new_status", amount: 25_000, status: "under_new_review" }],
    });
    const result = await reversal.reverseFeeAtSource({
      chargeId,
      accountId: ACCOUNT,
      stripe: stripe.port,
    });
    assert.deepEqual(result, { status: "refunded", feeId, targetMinor: 625, incrementMinor: 625 });
  });

  test("a fee already given back by Stripe (refund_application_fee) needs nothing more", async () => {
    const stripe = fakeStripe();
    const { chargeId, feeId, rowId } = await chargeWithFee(stripe, { amount: 10_000, fee: 300 });
    const charge = stripe.charges.get(chargeId);
    const fee = stripe.fees.get(feeId);
    assert.ok(charge && fee);
    // reversal-10: half of the charge refunded, the whole fee returned with it.
    charge.amountRefunded = 5_000;
    fee.amountRefunded = 300;
    const result = await reversal.reverseFeeAtSource({
      chargeId,
      accountId: ACCOUNT,
      stripe: stripe.port,
    });
    assert.deepEqual(result, { status: "unchanged", feeId, targetMinor: 150, incrementMinor: 0 });
    assert.deepEqual(stripe.refunds, []);
    // The ledger records what Stripe refunded, not the target.
    assert.deepEqual(await readRow(rowId), { status: "reversed", reversed: 300 });
  });

  test("a charge without an application fee is left alone", async () => {
    const stripe = fakeStripe();
    const chargeId = `ch_${RUN}_no_fee`;
    stripe.charges.set(chargeId, {
      amount: 10_000,
      amountRefunded: 10_000,
      feeId: null,
      paymentIntentId: `pi_${RUN}_no_fee`,
      disputes: [],
    });
    assert.deepEqual(
      await reversal.reverseFeeAtSource({ chargeId, accountId: ACCOUNT, stripe: stripe.port }),
      { status: "no_fee" },
    );
  });

  test("a Stripe error propagates, so the webhook answers 500", async () => {
    const stripe = fakeStripe();
    const { chargeId } = await chargeWithFee(stripe, { amount: 10_000, fee: 250 });
    const charge = stripe.charges.get(chargeId);
    assert.ok(charge);
    charge.amountRefunded = 10_000;
    const failing: FeeReversalStripe = {
      ...stripe.port,
      refundApplicationFee: async () => {
        throw new Error("Stripe is down");
      },
    };
    await assert.rejects(
      reversal.reverseFeeAtSource({ chargeId, accountId: ACCOUNT, stripe: failing }),
      /Stripe is down/,
    );
    // The lock was released: the retry goes through.
    const retried = await reversal.reverseFeeAtSource({
      chargeId,
      accountId: ACCOUNT,
      stripe: stripe.port,
    });
    assert.equal(retried.status, "refunded");
  });
});
