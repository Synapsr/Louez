import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";

import { eq } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { BillingAlerts } from "@/lib/billing-sync/alerts";
import { closeNetworkForSuite } from "@/lib/testing/network-guard";

import type { FeeReversalStripe } from "./fee-reversal";

// The platform's channel, faked for the whole suite: a reversal that finds a fee given
// back in excess with no alerts of its own runs the real ones, whose post lands here.
const posted: Array<{ kind: string; message: string }> = [];
mock.module("@/lib/discord/platform-notifications", {
  namedExports: {
    notifyBillingAlert: async (kind: string, message: string) => {
      posted.push({ kind, message });
    },
  },
});
closeNetworkForSuite();

// The fee refund at source (louez-billing docs/api, fees.md §9) on a migrated database,
// against a fake Stripe that keeps the fee's refunded amount as Stripe would.

const STORE = "store_fee_reversal";
const ACCOUNT = "acct_fee_reversal";
// Named locks are server-wide: other suites on the same MySQL must not share them.
const RUN = randomBytes(4).toString("hex");

type FakeCharge = {
  /** What was authorized. */
  amount: number;
  /** What was taken: less than `amount` after a partial capture. */
  amountCaptured: number;
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
        amount_captured: charge.amountCaptured,
        amount_refunded: charge.amountRefunded,
        application_fee: charge.feeId,
        payment_intent: charge.paymentIntentId,
      };
    },
    async retrieveApplicationFee(feeId) {
      const fee = fees.get(feeId);
      if (!fee) throw new Error(`no such fee: ${feeId}`);
      await pause();
      return {
        id: feeId,
        amount: fee.amount,
        amount_refunded: fee.amountRefunded,
        currency: "eur",
      };
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
    charge: {
      amount: number;
      /** What was captured, when less than the amount authorized. */
      captured?: number;
      fee: number;
      disputes?: FakeCharge["disputes"];
    },
  ) {
    const n = ++counter;
    const chargeId = `ch_${RUN}_${n}`;
    const feeId = `fee_${RUN}_${n}`;
    const paymentIntentId = `pi_${RUN}_${n}`;
    const reservationId = `res_fee_reversal_${n}`;
    stripe.charges.set(chargeId, {
      amount: charge.amount,
      amountCaptured: charge.captured ?? charge.amount,
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

  /** Whether no connection holds the charge's named lock. */
  const lockIsFree = async (chargeId: string) => {
    const [rows] = await louezDb.db.$client.query("SELECT IS_FREE_LOCK(?) AS free", [
      reversal.feeReversalLockName(chargeId),
    ]);
    return Number((rows as Array<{ free: number | string }>)[0]?.free) === 1;
  };

  /**
   * The platform's alerts, faked: each `fee_over_returned` keeps the fee given back in
   * excess it names, and whether the charge's lock was free when it was raised.
   */
  function fakeAlerts() {
    const sent: Array<{ chargeId: string; excessMinor: number; lockFree: boolean }> = [];
    const alerts: BillingAlerts = {
      log: { error() {}, info() {} },
      async alert(kind, message) {
        assert.equal(kind, "fee_over_returned");
        const [, chargeId, excess] =
          /^charge (\S+) on account .* by (\d+) \(minor units\)/.exec(message) ?? [];
        assert.ok(chargeId && excess, message);
        sent.push({
          chargeId,
          excessMinor: Number(excess),
          lockFree: await lockIsFree(chargeId),
        });
      },
    };
    const excesses = () => sent.map((alert) => alert.excessMinor);
    return { alerts, sent, excesses };
  }

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
    assert.deepEqual(first, {
      status: "refunded",
      feeId,
      targetMinor: 83,
      incrementMinor: 83,
      feeRefundedMinor: 83,
    });
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
    assert.deepEqual(again, {
      status: "unchanged",
      feeId,
      targetMinor: 167,
      incrementMinor: 0,
      feeRefundedMinor: 167,
    });
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
    // The won dispute counts for nothing: a refund of 5,000 aims at 125, below the 250
    // refunded. Counted, it would aim at 375 and refund 125 Stripe never takes back.
    charge.amountRefunded = 5_000;
    assert.deepEqual(await reverse(), {
      status: "unchanged",
      feeId,
      targetMinor: 125,
      incrementMinor: 0,
      feeRefundedMinor: 250,
    });
    // A later refund of the whole charge brings the target to the whole fee.
    charge.amountRefunded = 25_000;
    await reverse();
    assert.deepEqual(stripe.refunds, [
      { feeId, amount: 250, key: `appfee_reverse_${feeId}_0_250` },
      { feeId, amount: 375, key: `appfee_reverse_${feeId}_250_625` },
    ]);
  });

  test("after a partial capture, the fee follows what was captured, not what was authorized", async () => {
    const stripe = fakeStripe();
    // 100.00 authorized, 60.00 captured, a fee of 3.00 taken on it.
    const full = await chargeWithFee(stripe, { amount: 10_000, captured: 6_000, fee: 300 });
    const fullCharge = stripe.charges.get(full.chargeId);
    assert.ok(fullCharge);
    // All of the 60.00 refunded: the store keeps nothing, the whole fee goes back.
    fullCharge.amountRefunded = 6_000;
    assert.deepEqual(
      await reversal.reverseFeeAtSource({
        chargeId: full.chargeId,
        accountId: ACCOUNT,
        stripe: stripe.port,
      }),
      {
        status: "refunded",
        feeId: full.feeId,
        targetMinor: 300,
        incrementMinor: 300,
        feeRefundedMinor: 300,
      },
    );

    // 15.00 of the 60.00 refunded: a quarter of the fee.
    const partial = await chargeWithFee(stripe, { amount: 10_000, captured: 6_000, fee: 300 });
    const partialCharge = stripe.charges.get(partial.chargeId);
    assert.ok(partialCharge);
    partialCharge.amountRefunded = 1_500;
    assert.deepEqual(
      await reversal.reverseFeeAtSource({
        chargeId: partial.chargeId,
        accountId: ACCOUNT,
        stripe: stripe.port,
      }),
      {
        status: "refunded",
        feeId: partial.feeId,
        targetMinor: 75,
        incrementMinor: 75,
        feeRefundedMinor: 75,
      },
    );

    // A chargeback on 30.00 of the rest counts on the same base: 15.00 + 30.00 of 60.00.
    partialCharge.disputes = [{ id: "dp_partial", amount: 3_000, status: "needs_response" }];
    assert.deepEqual(
      await reversal.reverseFeeAtSource({
        chargeId: partial.chargeId,
        accountId: ACCOUNT,
        stripe: stripe.port,
      }),
      {
        status: "refunded",
        feeId: partial.feeId,
        targetMinor: 225,
        incrementMinor: 150,
        feeRefundedMinor: 225,
      },
    );
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
    assert.deepEqual(result, {
      status: "refunded",
      feeId,
      targetMinor: 625,
      incrementMinor: 625,
      feeRefundedMinor: 625,
    });
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
    assert.deepEqual(result, {
      status: "unchanged",
      feeId,
      targetMinor: 150,
      incrementMinor: 0,
      feeRefundedMinor: 300,
    });
    assert.deepEqual(stripe.refunds, []);
    // The ledger records what Stripe refunded, not the target.
    assert.deepEqual(await readRow(rowId), { status: "reversed", reversed: 300 });
  });

  test("a charge without an application fee is left alone", async () => {
    const stripe = fakeStripe();
    const chargeId = `ch_${RUN}_no_fee`;
    stripe.charges.set(chargeId, {
      amount: 10_000,
      amountCaptured: 10_000,
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

  test("a reversal needs one connection: its ledger write runs on the lock's", async () => {
    const stripe = fakeStripe();
    const { chargeId, rowId } = await chargeWithFee(stripe, { amount: 10_000, fee: 250 });
    const charge = stripe.charges.get(chargeId);
    assert.ok(charge);
    charge.amountRefunded = 10_000;

    // Nine of the pool's ten connections are taken by the rest of the app.
    const taken = await Promise.all(
      Array.from({ length: 9 }, () => louezDb.db.$client.getConnection()),
    );
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        reversal.reverseFeeAtSource({ chargeId, accountId: ACCOUNT, stripe: stripe.port }),
        new Promise<"stuck">((resolve) => {
          timer = setTimeout(() => resolve("stuck"), 5_000);
        }),
      ]);
      assert.notEqual(result, "stuck", "the reversal waited for a second connection");
    } finally {
      clearTimeout(timer);
      for (const connection of taken) connection.release();
    }
    assert.deepEqual(await readRow(rowId), { status: "reversed", reversed: 250 });
  });

  test("a burst of reversals on distinct charges leaves connections to the app", async () => {
    const stripe = fakeStripe();
    let inStripe = 0;
    let mostInStripe = 0;
    const order: string[] = [];
    const slow: FeeReversalStripe = {
      ...stripe.port,
      async retrieveCharge(chargeId, accountId) {
        inStripe++;
        mostInStripe = Math.max(mostInStripe, inStripe);
        await new Promise((resolve) => setTimeout(resolve, 300));
        return stripe.port.retrieveCharge(chargeId, accountId);
      },
      async refundApplicationFee(feeId, amountMinor, idempotencyKey) {
        await stripe.port.refundApplicationFee(feeId, amountMinor, idempotencyKey);
        inStripe--;
      },
    };
    const chargeIds: string[] = [];
    for (let index = 0; index < 12; index++) {
      const { chargeId } = await chargeWithFee(stripe, { amount: 10_000, fee: 250 });
      const charge = stripe.charges.get(chargeId);
      assert.ok(charge);
      charge.amountRefunded = 10_000;
      chargeIds.push(chargeId);
    }

    const burst = Promise.all(
      chargeIds.map((chargeId) =>
        reversal
          .reverseFeeAtSource({ chargeId, accountId: ACCOUNT, stripe: slow })
          .finally(() => order.push("reversal")),
      ),
    );
    // A storefront query during the burst gets a connection before any reversal ends.
    await louezDb.db.select({ id: louezDb.platformFees.id }).from(louezDb.platformFees).limit(1);
    order.push("query");
    const results = await burst;

    assert.deepEqual(new Set(results.map((result) => result.status)), new Set(["refunded"]));
    assert.equal(stripe.refunds.length, 12);
    assert.ok(
      mostInStripe <= reversal.REVERSALS_AT_ONCE,
      `${mostInStripe} reversals at once, more than ${reversal.REVERSALS_AT_ONCE}`,
    );
    assert.equal(order[0], "query");
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

  // The fee given back in excess (fees.md §9): one figure per charge, Stripe's fee
  // refunded less its share of what the store no longer keeps, read again on every
  // event that changes it, and alerted to the platform once the charge's lock is free.
  describe("the fee given back in excess", () => {
    async function excessCase(charge: { disputes?: FakeCharge["disputes"] } = {}) {
      const stripe = fakeStripe();
      const { chargeId } = await chargeWithFee(stripe, {
        amount: 10_000,
        fee: 300,
        disputes: charge.disputes,
      });
      const state = stripe.charges.get(chargeId);
      assert.ok(state);
      const alerted = fakeAlerts();
      const reverse = () =>
        reversal.reverseFeeAtSource({
          chargeId,
          accountId: ACCOUNT,
          stripe: stripe.port,
          alerts: alerted.alerts,
        });
      return { stripe, chargeId, state, alerted, reverse };
    }

    test("a refund of 60.00 that fails after its share was given back is alerted once, at 1.80", async () => {
      const { state, alerted, reverse } = await excessCase();
      state.amountRefunded = 6_000;
      await reverse();
      assert.deepEqual(alerted.excesses(), []);
      // The refund failed: Stripe no longer counts it.
      state.amountRefunded = 0;
      await reverse();
      assert.deepEqual(alerted.excesses(), [180]);
      assert.ok(alerted.sent.every((alert) => alert.lockFree));
    });

    test("two failed refunds of one charge leave 1.80, never their sum", async () => {
      const { stripe, state, alerted, reverse } = await excessCase();
      state.amountRefunded = 6_000;
      await reverse();
      state.amountRefunded = 0;
      await reverse();
      // A second refund of 30.00 while 1.80 is given back: its share is already given.
      state.amountRefunded = 3_000;
      await reverse();
      state.amountRefunded = 0;
      await reverse();
      assert.deepEqual(alerted.excesses(), [180, 90, 180]);
      assert.equal(stripe.refunds.length, 1);
      assert.ok(alerted.sent.every((alert) => alert.lockFree));
    });

    test("a dispute opened then won gives 3.00 in excess; one lost gives none", async () => {
      const won = await excessCase({
        disputes: [{ id: "dp_won", amount: 10_000, status: "needs_response" }],
      });
      await won.reverse();
      assert.deepEqual(won.alerted.excesses(), []);
      won.state.disputes = [{ id: "dp_won", amount: 10_000, status: "won" }];
      await won.reverse();
      assert.deepEqual(won.alerted.excesses(), [300]);

      const lost = await excessCase({
        disputes: [{ id: "dp_lost", amount: 10_000, status: "needs_response" }],
      });
      await lost.reverse();
      lost.state.disputes = [{ id: "dp_lost", amount: 10_000, status: "lost" }];
      await lost.reverse();
      assert.deepEqual(lost.alerted.excesses(), []);
    });

    test("a refund that failed, then a dispute: none while it is open, 3.00 once it is won", async () => {
      const { state, alerted, reverse } = await excessCase();
      state.amountRefunded = 6_000;
      await reverse();
      state.amountRefunded = 0;
      await reverse();
      assert.deepEqual(alerted.excesses(), [180]);
      state.disputes = [{ id: "dp_after", amount: 10_000, status: "needs_response" }];
      await reverse();
      assert.deepEqual(alerted.excesses(), [180]);
      state.disputes = [{ id: "dp_after", amount: 10_000, status: "won" }];
      await reverse();
      assert.deepEqual(alerted.excesses(), [180, 300]);
    });

    test("a dispute of 40.00, then a refund of 60.00 that fails: 1.80", async () => {
      const { state, alerted, reverse } = await excessCase({
        disputes: [{ id: "dp_before", amount: 4_000, status: "needs_response" }],
      });
      await reverse();
      state.amountRefunded = 6_000;
      await reverse();
      assert.deepEqual(alerted.excesses(), []);
      state.amountRefunded = 0;
      await reverse();
      assert.deepEqual(alerted.excesses(), [180]);
    });

    test("ordinary partial refunds raise no alert, call Stripe as before and write no row", async () => {
      const { stripe, chargeId, state, alerted } = await excessCase();
      const calls: string[] = [];
      const counted: FeeReversalStripe = {
        retrieveCharge: (...args) => (calls.push("charge"), stripe.port.retrieveCharge(...args)),
        retrieveApplicationFee: (...args) => (
          calls.push("fee"),
          stripe.port.retrieveApplicationFee(...args)
        ),
        listDisputes: (...args) => (calls.push("disputes"), stripe.port.listDisputes(...args)),
        refundApplicationFee: (...args) => (
          calls.push("refund"),
          stripe.port.refundApplicationFee(...args)
        ),
      };
      const activity = async () =>
        (
          await louezDb.db
            .select({ id: louezDb.reservationActivity.id })
            .from(louezDb.reservationActivity)
        ).length;
      const before = await activity();
      for (const refunded of [3_000, 8_000]) {
        state.amountRefunded = refunded;
        await reversal.reverseFeeAtSource({
          chargeId,
          accountId: ACCOUNT,
          stripe: counted,
          alerts: alerted.alerts,
        });
      }
      assert.deepEqual(alerted.excesses(), []);
      // Each reversal reads the charge, its fee and its disputes, then refunds its share.
      const oneReversal = ["charge", "fee", "disputes", "refund"];
      assert.deepEqual(calls, [...oneReversal, ...oneReversal]);
      assert.equal(await activity(), before);
    });

    test("an alert that fails never fails the reversal", async () => {
      const { state, chargeId, stripe } = await excessCase();
      state.amountRefunded = 6_000;
      const failing: BillingAlerts = {
        log: { error() {}, info() {} },
        alert: async () => {
          throw new Error("the channel is down");
        },
      };
      const reverse = () =>
        reversal.reverseFeeAtSource({
          chargeId,
          accountId: ACCOUNT,
          stripe: stripe.port,
          alerts: failing,
        });
      await reverse();
      state.amountRefunded = 0;
      const result = await reverse();
      assert.equal(result.status, "unchanged");
    });

    test("a refund made outside Louez between the reversal's reads of the charge and the fee is no excess", async () => {
      const { stripe, chargeId, state, alerted } = await excessCase();
      let moved = false;
      const racing: FeeReversalStripe = {
        ...stripe.port,
        async retrieveApplicationFee(feeId) {
          // A refund of 60.00 made in Stripe's dashboard gives back its share, 1.80,
          // after the reversal read the charge.
          const fee = stripe.fees.get(feeId);
          if (!moved && fee) {
            moved = true;
            state.amountRefunded = 6_000;
            fee.amountRefunded = 180;
          }
          return stripe.port.retrieveApplicationFee(feeId);
        },
      };
      const result = await reversal.reverseFeeAtSource({
        chargeId,
        accountId: ACCOUNT,
        stripe: racing,
        alerts: alerted.alerts,
      });
      assert.equal(result.status, "unchanged");
      assert.deepEqual(alerted.excesses(), []);
      assert.deepEqual(stripe.refunds, []);
    });

    test("an excess is alerted once the fee and the charge, read again, still show it, with their figures", async () => {
      const { stripe, chargeId, state, alerted } = await excessCase();
      const calls: string[] = [];
      let atAlert: number[] = [];
      // Before the charge is read again, a refund of 30.00 made in the meantime: the
      // fresh share is 0.90, the excess 0.90.
      let refundBeforeSecondRead = false;
      const counted: FeeReversalStripe = {
        ...stripe.port,
        retrieveCharge: (...args) => {
          calls.push("charge");
          if (refundBeforeSecondRead && calls.filter((call) => call === "charge").length === 2)
            state.amountRefunded = 3_000;
          return stripe.port.retrieveCharge(...args);
        },
        retrieveApplicationFee: (...args) => (
          calls.push("fee"),
          stripe.port.retrieveApplicationFee(...args)
        ),
        listDisputes: (...args) => (calls.push("disputes"), stripe.port.listDisputes(...args)),
      };
      const alerts: BillingAlerts = {
        ...alerted.alerts,
        alert: async (kind, message, note) => {
          atAlert.push(calls.length);
          await alerted.alerts.alert(kind, message, note);
        },
      };
      const reverse = () =>
        reversal.reverseFeeAtSource({ chargeId, accountId: ACCOUNT, stripe: counted, alerts });

      state.amountRefunded = 6_000;
      await reverse();
      // The refund failed: one alert, after the fee and the charge are read again.
      state.amountRefunded = 0;
      calls.length = 0;
      await reverse();
      assert.deepEqual(calls, ["charge", "fee", "disputes", "fee", "charge"]);
      assert.deepEqual(atAlert, [5]);
      assert.deepEqual(alerted.excesses(), [180]);

      // The same, with a refund of 30.00 landing before the second read of the charge.
      calls.length = 0;
      atAlert = [];
      refundBeforeSecondRead = true;
      await reverse();
      assert.deepEqual(alerted.excesses(), [180, 90]);
    });

    test("ten won disputes at once leave the pool its connections: each alert waits for its lock's release", async () => {
      const stripe = fakeStripe();
      const chargeIds: string[] = [];
      const quiet: BillingAlerts["log"] = { error() {}, info() {} };
      const noAlerts = fakeAlerts().alerts;
      for (let index = 0; index < 10; index++) {
        const { chargeId } = await chargeWithFee(stripe, {
          amount: 10_000,
          fee: 300,
          disputes: [{ id: `dp_${RUN}_${index}`, amount: 10_000, status: "needs_response" }],
        });
        await reversal.reverseFeeAtSource({
          chargeId,
          accountId: ACCOUNT,
          stripe: stripe.port,
          alerts: noAlerts,
        });
        const charge = stripe.charges.get(chargeId);
        assert.ok(charge);
        charge.disputes = [{ id: `dp_${RUN}_${index}`, amount: 10_000, status: "won" }];
        chargeIds.push(chargeId);
      }
      // The real alerts, whose hourly slot is a transaction on a pooled connection,
      // from a clean slot; the channel is the suite's fake.
      const { createBillingAlerts } = await import("@/lib/billing-sync/alerts");
      const { readSyncState } = await import("@/lib/billing-sync/state");
      await readSyncState();
      await louezDb.db.update(louezDb.billingSyncState).set({ alerts: {} });
      posted.length = 0;
      const alerts = createBillingAlerts({ log: quiet });

      // Six of the pool's ten connections are taken by the rest of the app.
      const taken = await Promise.all(
        Array.from({ length: 6 }, () => louezDb.db.$client.getConnection()),
      );
      let timer: NodeJS.Timeout | undefined;
      try {
        const result = await Promise.race([
          Promise.all(
            chargeIds.map((chargeId) =>
              reversal.reverseFeeAtSource({
                chargeId,
                accountId: ACCOUNT,
                stripe: stripe.port,
                alerts,
              }),
            ),
          ),
          new Promise<"stuck">((resolve) => {
            timer = setTimeout(() => resolve("stuck"), 10_000);
          }),
        ]);
        assert.notEqual(result, "stuck", "an alert waited for a connection while holding a lock");
      } finally {
        clearTimeout(timer);
        for (const connection of taken) connection.release();
      }
      // Ten alerts, one post: the first of its kind this hour, which says so.
      assert.equal(posted.length, 1);
      assert.equal(posted[0]?.kind, "fee_over_returned");
      assert.match(
        posted[0]?.message ?? "",
        /first fee_over_returned alert this hour: the error log holds every occurrence, each with its charge\.$/,
      );
    });
  });
});
