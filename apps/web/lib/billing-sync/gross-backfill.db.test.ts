import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { RowDataPacket } from "mysql2/promise";
import Stripe from "stripe";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { GrossBackfillEvent, GrossBackfillLog } from "./gross-backfill";
import {
  type StripeAnswer,
  type StripeChargeReads,
  stripeChargeReads,
} from "./gross-backfill-core";

// The gross backfill on a migrated database (louez-billing docs/plans/m1-pr-b-plan.md
// decisions 6 and 7; docs/api README Q7): what it fills, its marks, the state column,
// a second run, a Stripe failure mid-run, an account that refuses Louez, a key that
// finds nothing, refunds Louez never recorded, and the script's guards. Stripe is a
// stub: no network. The script is run only where it makes no Stripe call.

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(APP_ROOT, "scripts/run-billing-gross-backfill.ts");
const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const DATABASE_SUITE = { skip: skipWithoutTestDatabase(), timeout: 120_000 };
/** spawnSync blocks the suite's timer: the script is killed after this instead. */
const SCRIPT_TIMEOUT_MS = 30_000;

const STORE = "gb_store";
const OTHER_STORE = "gb_store_2";
const OLD = "2026-03-02 10:00:00";

type ChargeAnswer = {
  object: "charge";
  id: string;
  amount: number;
  amount_captured: number;
  amount_refunded: number;
  currency: string;
  status: string;
  captured: boolean;
};

const chargeOf = (id: string, amount: number, captured = amount, refunded = 0): ChargeAnswer => ({
  object: "charge",
  id,
  amount,
  amount_captured: captured,
  amount_refunded: refunded,
  currency: "eur",
  status: "succeeded",
  captured: captured > 0,
});

const intentOf = (charge: ChargeAnswer) => ({ object: "payment_intent", latest_charge: charge });

/**
 * Connected accounts in memory: objects by `account id`, a call log, failures by object
 * id, and accounts that refuse the platform.
 */
function createFakeStripe() {
  const objects = new Map<string, unknown>();
  const calls: string[] = [];
  const failing = new Set<string>();
  const refusing = new Set<string>();
  const read =
    (kind: string) =>
    async (accountId: string, id: string): Promise<StripeAnswer> => {
      calls.push(`${kind} ${accountId} ${id}`);
      if (failing.has(id)) throw new Error(`Stripe is unreachable for ${id}`);
      if (refusing.has(accountId)) return { missing: "account_inaccessible" };
      const object = objects.get(`${accountId} ${id}`);
      return object === undefined ? { missing: "not_found_on_stripe" } : { found: object };
    };
  const reads: StripeChargeReads = {
    charge: read("charge"),
    paymentIntent: read("paymentIntent"),
    checkoutSession: read("checkoutSession"),
  };
  return {
    reads,
    calls,
    failing,
    refusing,
    put(accountId: string, id: string, object: unknown) {
      objects.set(`${accountId} ${id}`, object);
    },
    reset() {
      objects.clear();
      calls.length = 0;
      failing.clear();
      refusing.clear();
    },
  };
}

describe("gross backfill (database)", DATABASE_SUITE, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let backfill: typeof import("./gross-backfill");
  const stripe = createFakeStripe();
  const events: Array<{ level: "info" | "warn" | "error"; event: GrossBackfillEvent }> = [];
  const logs: GrossBackfillLog = {
    info: (event) => events.push({ level: "info", event }),
    warn: (event) => events.push({ level: "warn", event }),
    error: (event) => events.push({ level: "error", event }),
  };
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("gross_backfill");
    louezDb = await import("@louez/db");
    backfill = await import("./gross-backfill");
  });
  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });
  beforeEach(async () => {
    process.env.LOUEZ_BILLING = "cloud";
    // Marks write queue rows; nothing sends them.
    process.env.BILLING_SERVICE_URL = "http://billing.invalid";
    stripe.reset();
    events.length = 0;
    await sql(
      "DELETE FROM payments",
      "DELETE FROM payment_requests",
      "DELETE FROM reservation_activity",
      "DELETE FROM reservation_items",
      "DELETE FROM reservations",
      "DELETE FROM stores",
      "DELETE FROM billing_sync_queue",
      "DELETE FROM billing_sync_state",
    );
    await sql(
      `INSERT INTO stores (id, user_id, name, slug, stripe_account_id)
       VALUES ('${STORE}', 'u1', 'Store', 'gb-store', 'acct_store'),
              ('${OTHER_STORE}', 'u2', 'Other', 'gb-store-2', 'acct_new')`,
    );
  });
  afterEach(() => {
    for (const [name, value] of [
      ["LOUEZ_BILLING", env.billing],
      ["BILLING_SERVICE_URL", env.url],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function sql(...statements: string[]): Promise<void> {
    const connection = await database.connect();
    try {
      for (const statement of statements) await connection.query(statement);
    } finally {
      await connection.end();
    }
  }

  async function select(statement: string): Promise<Record<string, unknown>[]> {
    const connection = await database.connect();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(statement);
      return rows.map((row) => ({ ...row }));
    } finally {
      await connection.end();
    }
  }

  async function reservation(
    id: string,
    options: { store?: string; insurance?: string; total?: string; currency?: string } = {},
  ): Promise<void> {
    const total = options.total ?? "100.00";
    await sql(
      `INSERT INTO reservations (id, store_id, customer_id, number, start_date, end_date,
                                 subtotal_amount, deposit_amount, total_amount, tulip_insurance_amount,
                                 currency, created_at, updated_at)
       VALUES ('${id}', '${options.store ?? STORE}', 'c', '${id}', '2026-03-10 08:00:00',
               '2026-03-12 08:00:00', ${total}, 0, ${total}, ${options.insurance ?? "NULL"},
               ${options.currency === undefined ? "NULL" : `'${options.currency}'`},
               '${OLD}', '${OLD}')`,
    );
  }

  type PaymentFixture = {
    id: string;
    reservationId: string;
    amount: string;
    type?: string;
    method?: string;
    status?: string;
    paymentIntentId?: string;
    chargeId?: string;
    sessionId?: string;
    refundId?: string;
    refundOf?: string;
    accountId?: string;
    currency?: string;
    grossMinor?: number;
    insuranceShareMinor?: number;
    paymentRequestId?: string;
  };

  const text = (value: string | undefined) => (value === undefined ? "NULL" : `'${value}'`);
  const number = (value: number | undefined) => (value === undefined ? "NULL" : String(value));

  /** Payments as rows written before PR b: no billing facts unless given. */
  async function payment(...rows: PaymentFixture[]): Promise<void> {
    for (const row of rows) {
      await sql(
        `INSERT INTO payments (id, reservation_id, amount, payment_type, payment_method, payment_status,
                               stripe_payment_intent_id, stripe_charge_id, stripe_checkout_session_id,
                               stripe_refund_id, refund_of_payment_id, stripe_account_id, currency,
                               gross_minor, insurance_share_minor, payment_request_id, paid_at,
                               created_at, updated_at)
         VALUES ('${row.id}', '${row.reservationId}', ${row.amount}, '${row.type ?? "rental"}',
                 '${row.method ?? "stripe"}', '${row.status ?? "completed"}',
                 ${text(row.paymentIntentId)}, ${text(row.chargeId)}, ${text(row.sessionId)},
                 ${text(row.refundId)}, ${text(row.refundOf)}, ${text(row.accountId)},
                 '${row.currency ?? "EUR"}', ${number(row.grossMinor)},
                 ${number(row.insuranceShareMinor)}, ${text(row.paymentRequestId)},
                 '${OLD}', '${OLD}', '${OLD}')`,
      );
    }
  }

  async function facts(): Promise<Record<string, unknown>[]> {
    return select(
      `SELECT id, amount, gross_minor AS gross, stripe_charge_id AS chargeId,
              insurance_share_minor AS share, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt
       FROM payments ORDER BY id`,
    );
  }

  async function queue(): Promise<Record<string, unknown>[]> {
    return select(
      `SELECT CAST(aggregate_type AS CHAR) AS type, aggregate_id AS id, version, status
       FROM billing_sync_queue ORDER BY aggregate_id`,
    );
  }

  async function backfilledAt(): Promise<string | null> {
    const [row] = await select(
      `SELECT DATE_FORMAT(gross_backfilled_at, '%Y-%m-%d %H:%i:%s.%f') AS at FROM billing_sync_state WHERE id = 1`,
    );
    const at = row?.at;
    return typeof at === "string" ? at : null;
  }

  const run = (apply: boolean) =>
    backfill.runGrossBackfill({ apply, stripe: stripe.reads, log: logs });

  /**
   * One reservation per case:
   * - a: a checkout netted by a refund (shape 3), its charge found through its session,
   *   on the store's account, with insurance;
   * - b: a cash payment, and a deposit hold with its capture, which share a charge;
   * - c: a charge on the account the payment recorded, and a payment never paid;
   * - d: a PaymentIntent Stripe does not have (the store reconnected another account);
   * - e: a charge another payment already holds;
   * - f: a charge in another currency than its payment;
   * - g: a payment that already has every fact.
   */
  async function seedCases(): Promise<void> {
    await reservation("gb_res_a", { insurance: "10.00" });
    await reservation("gb_res_b");
    await reservation("gb_res_c", { store: OTHER_STORE });
    await reservation("gb_res_d", { store: OTHER_STORE });
    await reservation("gb_res_e");
    await reservation("gb_res_f");
    await reservation("gb_res_g");
    await payment(
      { id: "gb_pay_a", reservationId: "gb_res_a", amount: "60.00", sessionId: "cs_a" },
      {
        id: "gb_ref_a",
        reservationId: "gb_res_a",
        amount: "40.00",
        refundId: "re_a",
        refundOf: "gb_pay_a",
      },
      { id: "gb_pay_b1", reservationId: "gb_res_b", amount: "50.00", method: "cash" },
      {
        id: "gb_pay_b2",
        reservationId: "gb_res_b",
        amount: "200.00",
        type: "deposit_hold",
        paymentIntentId: "pi_b",
      },
      {
        id: "gb_pay_b3",
        reservationId: "gb_res_b",
        amount: "80.00",
        type: "deposit_capture",
        paymentIntentId: "pi_b",
        chargeId: "ch_b",
      },
      {
        id: "gb_pay_c1",
        reservationId: "gb_res_c",
        amount: "30.00",
        chargeId: "ch_c",
        accountId: "acct_old",
      },
      {
        id: "gb_pay_c2",
        reservationId: "gb_res_c",
        amount: "30.00",
        status: "pending",
        sessionId: "cs_c2",
      },
      { id: "gb_pay_d", reservationId: "gb_res_d", amount: "45.00", paymentIntentId: "pi_d" },
      { id: "gb_pay_e", reservationId: "gb_res_e", amount: "30.00", paymentIntentId: "pi_e" },
      {
        id: "gb_pay_f",
        reservationId: "gb_res_f",
        amount: "25.00",
        currency: "USD",
        paymentIntentId: "pi_f",
      },
      {
        id: "gb_pay_g",
        reservationId: "gb_res_g",
        amount: "25.00",
        chargeId: "ch_g",
        grossMinor: 2500,
        insuranceShareMinor: 0,
      },
    );
    stripe.put("acct_store", "cs_a", {
      object: "checkout.session",
      // 40.00 refunded: the refund row records it.
      payment_intent: intentOf(chargeOf("ch_a", 10_000, 10_000, 4000)),
    });
    stripe.put("acct_store", "pi_b", {
      object: "payment_intent",
      latest_charge: chargeOf("ch_b", 20_000, 8000),
    });
    stripe.put("acct_store", "ch_b", chargeOf("ch_b", 20_000, 8000));
    stripe.put("acct_old", "ch_c", chargeOf("ch_c", 3000));
    stripe.put("acct_store", "pi_e", {
      object: "payment_intent",
      latest_charge: chargeOf("ch_c", 3000),
    });
    stripe.put("acct_store", "pi_f", {
      object: "payment_intent",
      latest_charge: chargeOf("ch_f", 2500),
    });
    stripe.put("acct_store", "ch_f", chargeOf("ch_f", 2500));
  }

  const EXPECTED_FACTS = [
    // Its session's charge; the share of its 10.00 insurance in a 100.00 total.
    {
      id: "gb_pay_a",
      amount: "60.00",
      gross: 10_000,
      chargeId: "ch_a",
      share: 1000,
      updatedAt: OLD,
    },
    { id: "gb_pay_b1", amount: "50.00", gross: 5000, chargeId: null, share: 0, updatedAt: OLD },
    // The hold: what was authorised, and no charge id. The capture: what was captured.
    { id: "gb_pay_b2", amount: "200.00", gross: 20_000, chargeId: null, share: 0, updatedAt: OLD },
    { id: "gb_pay_b3", amount: "80.00", gross: 8000, chargeId: "ch_b", share: 0, updatedAt: OLD },
    { id: "gb_pay_c1", amount: "30.00", gross: 3000, chargeId: "ch_c", share: 0, updatedAt: OLD },
    { id: "gb_pay_c2", amount: "30.00", gross: null, chargeId: null, share: null, updatedAt: OLD },
    { id: "gb_pay_d", amount: "45.00", gross: null, chargeId: null, share: null, updatedAt: OLD },
    // Its gross, but not the charge id gb_pay_c1 holds.
    { id: "gb_pay_e", amount: "30.00", gross: 3000, chargeId: null, share: 0, updatedAt: OLD },
    { id: "gb_pay_f", amount: "25.00", gross: null, chargeId: "ch_f", share: null, updatedAt: OLD },
    { id: "gb_pay_g", amount: "25.00", gross: 2500, chargeId: "ch_g", share: 0, updatedAt: OLD },
    // Refund rows are never sent as payments: left as they are.
    { id: "gb_ref_a", amount: "40.00", gross: null, chargeId: null, share: null, updatedAt: OLD },
  ];

  const EXPECTED_UNRESOLVED = [
    {
      paymentId: "gb_pay_d",
      reservationId: "gb_res_d",
      storeId: OTHER_STORE,
      facts: ["grossMinor", "stripeChargeId"],
      reason: "not_found_on_stripe",
    },
    {
      paymentId: "gb_pay_d",
      reservationId: "gb_res_d",
      storeId: OTHER_STORE,
      facts: ["insuranceShareMinor"],
      reason: "gross_unknown",
    },
    {
      paymentId: "gb_pay_e",
      reservationId: "gb_res_e",
      storeId: STORE,
      facts: ["stripeChargeId"],
      reason: "charge_shared",
    },
    {
      paymentId: "gb_pay_f",
      reservationId: "gb_res_f",
      storeId: STORE,
      facts: ["grossMinor"],
      reason: "currency_mismatch",
    },
    {
      paymentId: "gb_pay_f",
      reservationId: "gb_res_f",
      storeId: STORE,
      facts: ["insuranceShareMinor"],
      reason: "gross_unknown",
    },
  ];

  const EXPECTED_HELD = [
    { storeId: STORE, payments: 1 },
    { storeId: OTHER_STORE, payments: 1 },
  ];

  test("a dry run reads Stripe, reports what --apply would write, and writes nothing", async () => {
    await seedCases();
    const before = await facts();

    const result = await run(false);
    assert.deepEqual(result.outcome, { kind: "done", grossBackfilledAt: null });
    assert.equal(result.payments, 8);
    assert.equal(result.reservations, 6);
    assert.equal(result.stripeLookups, 7);
    assert.deepEqual(result.filled, { grossMinor: 6, stripeChargeId: 2, insuranceShareMinor: 6 });
    assert.equal(result.reservationsChanged, 5);
    assert.deepEqual(result.unresolved, EXPECTED_UNRESOLVED);
    // d and f stay without gross; c2 is pending, so the heartbeat does not count it.
    assert.deepEqual(result.storesHeld, EXPECTED_HELD);
    assert.deepEqual(result.refundGaps, []);

    assert.deepEqual(await facts(), before);
    assert.deepEqual(await queue(), []);
    assert.deepEqual(await select("SELECT id FROM billing_sync_state"), []);
  });

  test("--apply fills each fact from Stripe or the stored amount, marks what changed, and sets gross_backfilled_at", async () => {
    await seedCases();

    const result = await run(true);
    assert.equal(result.outcome.kind, "done");
    assert.ok(result.outcome.kind === "done" && result.outcome.grossBackfilledAt instanceof Date);
    assert.deepEqual(result.filled, { grossMinor: 6, stripeChargeId: 2, insuranceShareMinor: 6 });
    assert.equal(result.reservationsChanged, 5);
    assert.deepEqual(result.unresolved, EXPECTED_UNRESOLVED);
    assert.deepEqual(result.storesHeld, EXPECTED_HELD);

    assert.deepEqual(await facts(), EXPECTED_FACTS);
    // Each changed reservation is marked; d changed nothing and g needed nothing.
    assert.deepEqual(await queue(), [
      { type: "reservation", id: "gb_res_a", version: 1, status: "pending" },
      { type: "reservation", id: "gb_res_b", version: 1, status: "pending" },
      { type: "reservation", id: "gb_res_c", version: 1, status: "pending" },
      { type: "reservation", id: "gb_res_e", version: 1, status: "pending" },
      { type: "reservation", id: "gb_res_f", version: 1, status: "pending" },
    ]);
    assert.notEqual(await backfilledAt(), null);
    // The heartbeat now counts what stays without gross: d and f, not the pending c2.
    assert.deepEqual(
      await select(
        `SELECT id FROM payments WHERE payment_status = 'completed' AND gross_minor IS NULL
           AND refund_of_payment_id IS NULL ORDER BY id`,
      ),
      [{ id: "gb_pay_d" }, { id: "gb_pay_f" }],
    );
    assert.deepEqual(
      events.map(({ level, event }) => `${level} ${event.billing.event}`),
      ["warn gross_backfill"],
    );
  });

  test("a second run changes nothing", async () => {
    await seedCases();
    await run(true);
    const firstFacts = await facts();
    const firstQueue = await queue();
    const firstAt = await backfilledAt();
    const calls = stripe.calls.length;

    const second = await run(true);
    assert.equal(second.outcome.kind, "done");
    assert.deepEqual(second.filled, { grossMinor: 0, stripeChargeId: 0, insuranceShareMinor: 0 });
    assert.equal(second.reservationsChanged, 0);
    // Only the unresolved payments are read again.
    assert.equal(second.payments, 3);
    assert.deepEqual(stripe.calls.slice(calls), [
      "paymentIntent acct_new pi_d",
      "paymentIntent acct_store pi_e",
      // It has the charge id the first run gave it.
      "charge acct_store ch_f",
    ]);
    assert.deepEqual(await facts(), firstFacts);
    assert.deepEqual(await queue(), firstQueue);
    assert.equal(await backfilledAt(), firstAt);
  });

  test("a Stripe failure mid-run keeps what was written, leaves the rest and the state, and the next run finishes", async () => {
    for (const id of ["gb_fail_1", "gb_fail_2", "gb_fail_3"]) {
      await reservation(id);
      await payment({
        id: `${id}_pay`,
        reservationId: id,
        amount: "70.00",
        paymentIntentId: `pi_${id}`,
      });
      stripe.put("acct_store", `pi_${id}`, {
        object: "payment_intent",
        latest_charge: chargeOf(`ch_${id}`, 7000),
      });
    }
    stripe.failing.add("pi_gb_fail_2");

    const failed = await run(true);
    assert.deepEqual(failed.outcome, {
      kind: "stripe_failed",
      paymentId: "gb_fail_2_pay",
      reservationId: "gb_fail_2",
      error: "Stripe is unreachable for pi_gb_fail_2",
    });
    assert.deepEqual(
      (await facts()).map((row) => [row.id, row.gross, row.chargeId]),
      [
        ["gb_fail_1_pay", 7000, "ch_gb_fail_1"],
        ["gb_fail_2_pay", null, null],
        ["gb_fail_3_pay", null, null],
      ],
    );
    assert.deepEqual(
      (await queue()).map((row) => row.id),
      ["gb_fail_1"],
    );
    assert.equal(await backfilledAt(), null);
    assert.deepEqual(
      events.map(({ level, event }) => `${level} ${event.billing.event}`),
      ["error gross_backfill_stripe_failed", "warn gross_backfill"],
    );

    stripe.failing.clear();
    const calls = stripe.calls.length;
    const resumed = await run(true);
    assert.equal(resumed.outcome.kind, "done");
    assert.equal(resumed.payments, 2);
    assert.deepEqual(stripe.calls.slice(calls), [
      "paymentIntent acct_store pi_gb_fail_2",
      "paymentIntent acct_store pi_gb_fail_3",
    ]);
    assert.deepEqual(
      (await facts()).map((row) => [row.id, row.gross, row.chargeId]),
      [
        ["gb_fail_1_pay", 7000, "ch_gb_fail_1"],
        ["gb_fail_2_pay", 7000, "ch_gb_fail_2"],
        ["gb_fail_3_pay", 7000, "ch_gb_fail_3"],
      ],
    );
    assert.deepEqual(
      (await queue()).map((row) => `${row.id} ${row.version}`),
      ["gb_fail_1 1", "gb_fail_2 1", "gb_fail_3 1"],
    );
    assert.notEqual(await backfilledAt(), null);
  });

  test("without a Stripe reader, a payment that needs Stripe stops it before anything is written", async () => {
    await seedCases();
    const before = await facts();

    const result = await backfill.runGrossBackfill({ apply: true, stripe: null, log: logs });
    assert.deepEqual(result.outcome, { kind: "needs_stripe" });
    assert.equal(result.stripeLookups, 7);
    assert.deepEqual(await facts(), before);
    assert.deepEqual(await queue(), []);
    assert.equal(await backfilledAt(), null);
  });

  test("with the billing service off, the marks write nothing", async () => {
    delete process.env.BILLING_SERVICE_URL;
    await reservation("gb_res_cash");
    await payment({
      id: "gb_pay_cash",
      reservationId: "gb_res_cash",
      amount: "12.50",
      method: "cash",
    });

    const result = await backfill.runGrossBackfill({ apply: true, stripe: null, log: logs });
    assert.equal(result.outcome.kind, "done");
    assert.deepEqual(
      (await facts()).map((row) => [row.id, row.gross, row.share]),
      [["gb_pay_cash", 1250, 0]],
    );
    assert.deepEqual(await queue(), []);
  });

  test("an account that refuses Louez leaves its payments unresolved, is read once, and the run still finishes", async () => {
    // A Standard account that revoked Louez keeps its id on the store.
    await sql(
      `INSERT INTO stores (id, user_id, name, slug, stripe_account_id)
       VALUES ('gb_store_revoked', 'u3', 'Revoked', 'gb-store-revoked', 'acct_revoked')`,
    );
    // Sorted first, so the run meets the refusal before the readable payment.
    for (const [id, status] of [
      ["gb_r1_revoked", "completed"],
      ["gb_r2_revoked", "refunded"],
    ]) {
      await reservation(id, { store: "gb_store_revoked" });
      await payment({
        id: `${id}_pay`,
        reservationId: id,
        amount: "40.00",
        status,
        paymentIntentId: `pi_${id}`,
      });
    }
    await reservation("gb_r3_ok");
    await payment({
      id: "gb_r3_ok_pay",
      reservationId: "gb_r3_ok",
      amount: "40.00",
      paymentIntentId: "pi_ok",
    });

    // Stripe's client, as the script builds it, answering as Stripe does.
    const client = new Stripe("sk_test_stub");
    const calls: string[] = [];
    Reflect.set(
      client.paymentIntents,
      "retrieve",
      async (id: string, _params: unknown, options: { stripeAccount: string }) => {
        calls.push(`${options.stripeAccount} ${id}`);
        if (options.stripeAccount === "acct_revoked") {
          throw new Stripe.errors.StripePermissionError({
            type: "invalid_request_error",
            statusCode: 403,
            message:
              "The provided key 'sk_live_****' does not have access to account 'acct_revoked' (or that account does not exist). Application access may have been revoked.",
          });
        }
        return intentOf(chargeOf("ch_ok", 4000));
      },
    );

    const result = await backfill.runGrossBackfill({
      apply: true,
      stripe: stripeChargeReads(client),
      log: logs,
    });
    assert.equal(result.outcome.kind, "done");
    assert.deepEqual(calls, ["acct_revoked pi_gb_r1_revoked", "acct_store pi_ok"]);
    assert.deepEqual(
      result.unresolved.map(
        (entry) => `${entry.paymentId} ${entry.facts.join(",")} ${entry.reason}`,
      ),
      [
        "gb_r1_revoked_pay grossMinor,stripeChargeId account_inaccessible",
        "gb_r1_revoked_pay insuranceShareMinor gross_unknown",
        "gb_r2_revoked_pay grossMinor,stripeChargeId account_inaccessible",
        "gb_r2_revoked_pay insuranceShareMinor gross_unknown",
      ],
    );
    // Only the store that revoked Louez is held, for its completed payment: the heartbeat
    // does not count a refunded one.
    assert.deepEqual(result.storesHeld, [{ storeId: "gb_store_revoked", payments: 1 }]);
    assert.deepEqual(
      (await facts()).map((row) => [row.id, row.gross, row.chargeId]),
      [
        ["gb_r1_revoked_pay", null, null],
        ["gb_r2_revoked_pay", null, null],
        ["gb_r3_ok_pay", 4000, "ch_ok"],
      ],
    );
    assert.notEqual(await backfilledAt(), null);

    // A second run reads only the refused account, and finds nothing: the column is set,
    // so that is not a wrong key.
    const second = await backfill.runGrossBackfill({
      apply: true,
      stripe: stripeChargeReads(client),
      log: logs,
    });
    assert.equal(second.outcome.kind, "done");
    assert.deepEqual(calls.slice(2), ["acct_revoked pi_gb_r1_revoked"]);
  });

  test("when Stripe finds none of the payments, as with a test-mode key, gross_backfilled_at stays unset", async () => {
    await reservation("gb_res_live");
    await payment(
      {
        id: "gb_pay_live",
        reservationId: "gb_res_live",
        amount: "40.00",
        paymentIntentId: "pi_live",
      },
      { id: "gb_pay_live_cash", reservationId: "gb_res_live", amount: "10.00", method: "cash" },
    );

    const dry = await run(false);
    assert.deepEqual(dry.outcome, { kind: "stripe_found_none", lookups: 1 });

    const applied = await run(true);
    assert.deepEqual(applied.outcome, { kind: "stripe_found_none", lookups: 1 });
    // The cash payment's facts come from the database, and are written.
    assert.deepEqual(
      (await facts()).map((row) => [row.id, row.gross, row.share]),
      [
        ["gb_pay_live", null, null],
        ["gb_pay_live_cash", 1000, 0],
      ],
    );
    assert.equal(await backfilledAt(), null);
    assert.deepEqual(
      events.map(({ level, event }) => `${level} ${event.billing.event}`),
      ["warn gross_backfill", "warn gross_backfill"],
    );

    // A key that may read no account at all.
    stripe.refusing.add("acct_store");
    const refused = await run(true);
    assert.deepEqual(refused.outcome, { kind: "stripe_found_none", lookups: 1 });
    assert.equal(await backfilledAt(), null);
  });

  test("the insurance share follows the payment's kind, and a manual payment takes the reservation's currency", async () => {
    await reservation("gb_res_k", { insurance: "10.00" });
    await sql(
      `INSERT INTO payment_requests (id, store_id, reservation_id, token, amount, currency, description,
                                     type, status, expires_at)
       VALUES ('gb_pr_k', '${STORE}', 'gb_res_k', 'gb-token-k', 30.00, 'EUR', 'Extra', 'custom',
               'completed', '${OLD}')`,
    );
    // A JPY reservation whose cash payment kept the column's default currency.
    await reservation("gb_res_jpy", { currency: "JPY", total: "10000.00" });
    await payment(
      // A custom payment request carries no share (fees.md §4), even on an insured reservation.
      {
        id: "gb_pay_k1",
        reservationId: "gb_res_k",
        amount: "30.00",
        method: "cash",
        paymentRequestId: "gb_pr_k",
      },
      { id: "gb_pay_k2", reservationId: "gb_res_k", amount: "50.00", method: "cash" },
      { id: "gb_pay_jpy", reservationId: "gb_res_jpy", amount: "5000.00", method: "cash" },
    );

    const result = await run(true);
    assert.equal(result.outcome.kind, "done");
    assert.deepEqual(
      (await facts()).map((row) => [row.id, row.gross, row.share]),
      [
        ["gb_pay_jpy", 5000, 0],
        ["gb_pay_k1", 3000, 0],
        // 10.00 of insurance in a 100.00 total: a tenth of 50.00.
        ["gb_pay_k2", 5000, 500],
      ],
    );
  });

  test("two payments that resolve to the same new charge: only the first gets it, in a dry run and with --apply", async () => {
    await reservation("gb_res_s1");
    await reservation("gb_res_s2");
    await payment(
      { id: "gb_pay_s1a", reservationId: "gb_res_s1", amount: "30.00", paymentIntentId: "pi_s1a" },
      { id: "gb_pay_s1b", reservationId: "gb_res_s1", amount: "30.00", sessionId: "cs_s1b" },
      { id: "gb_pay_s2", reservationId: "gb_res_s2", amount: "30.00", paymentIntentId: "pi_s2" },
    );
    const shared = chargeOf("ch_s", 3000);
    stripe.put("acct_store", "pi_s1a", intentOf(shared));
    stripe.put("acct_store", "cs_s1b", {
      object: "checkout.session",
      payment_intent: intentOf(shared),
    });
    stripe.put("acct_store", "pi_s2", intentOf(shared));
    const sharedEntries = [
      {
        paymentId: "gb_pay_s1b",
        reservationId: "gb_res_s1",
        storeId: STORE,
        facts: ["stripeChargeId"],
        reason: "charge_shared",
      },
      {
        paymentId: "gb_pay_s2",
        reservationId: "gb_res_s2",
        storeId: STORE,
        facts: ["stripeChargeId"],
        reason: "charge_shared",
      },
    ];

    const dry = await run(false);
    assert.deepEqual(dry.filled, { grossMinor: 3, stripeChargeId: 1, insuranceShareMinor: 3 });
    assert.deepEqual(dry.unresolved, sharedEntries);

    const applied = await run(true);
    assert.deepEqual(applied.unresolved, sharedEntries);
    assert.deepEqual(
      (await facts()).map((row) => [row.id, row.gross, row.chargeId]),
      [
        ["gb_pay_s1a", 3000, "ch_s"],
        ["gb_pay_s1b", 3000, null],
        ["gb_pay_s2", 3000, null],
      ],
    );
  });

  describe("a reservation's writes and its mark (DL-13)", () => {
    const trigger = (body: string) =>
      sql(
        "DROP TRIGGER IF EXISTS gb_queue_check",
        `CREATE TRIGGER gb_queue_check BEFORE INSERT ON billing_sync_queue FOR EACH ROW ${body}`,
      );
    afterEach(() => sql("DROP TRIGGER IF EXISTS gb_queue_check"));

    test("a mark that fails rolls back the reservation's payment writes", async () => {
      await reservation("gb_res_dl13");
      await payment({
        id: "gb_pay_dl13",
        reservationId: "gb_res_dl13",
        amount: "20.00",
        method: "cash",
      });
      await trigger("SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'gb: the mark failed'");

      await assert.rejects(run(true));
      assert.deepEqual(
        (await facts()).map((row) => [row.id, row.gross, row.share]),
        [["gb_pay_dl13", null, null]],
      );
      assert.deepEqual(await queue(), []);
      assert.equal(await backfilledAt(), null);
    });

    test("the mark runs in the transaction that writes the payments", async () => {
      await reservation("gb_res_dl13");
      await payment({
        id: "gb_pay_dl13",
        reservationId: "gb_res_dl13",
        amount: "20.00",
        method: "cash",
      });
      // Another connection cannot see the transaction's uncommitted write.
      await trigger(
        `BEGIN
           IF (SELECT gross_minor FROM payments WHERE id = 'gb_pay_dl13') IS NULL THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'gb: the mark does not see the payment write';
           END IF;
         END`,
      );

      const result = await run(true);
      assert.equal(result.outcome.kind, "done");
      assert.deepEqual(
        (await facts()).map((row) => [row.id, row.gross]),
        [["gb_pay_dl13", 2000]],
      );
      assert.deepEqual(
        (await queue()).map((row) => row.id),
        ["gb_res_dl13"],
      );
    });
  });

  test("a refund Stripe made that Louez's rows do not record is listed, and the gross is still filled", async () => {
    for (const id of ["gb_res_r1", "gb_res_r2", "gb_res_r3", "gb_res_r4"]) await reservation(id);
    await payment(
      // Refunded in full before 2026-06-18: the webhook stamped the refund id, netted nothing.
      {
        id: "gb_pay_r1",
        reservationId: "gb_res_r1",
        amount: "80.00",
        status: "refunded",
        refundId: "re_r1",
        paymentIntentId: "pi_r1",
      },
      // A dashboard refund before 2026-08-20: stamped, not netted, and a row with the
      // charge id, linked once the backfill gives the payment that charge id.
      {
        id: "gb_pay_r2",
        reservationId: "gb_res_r2",
        amount: "100.00",
        refundId: "re_r2",
        paymentIntentId: "pi_r2",
      },
      {
        id: "gb_ref_r2",
        reservationId: "gb_res_r2",
        amount: "30.00",
        refundId: "re_r2",
        chargeId: "ch_r2",
      },
      // Since 2026-08-20: netted, and a linked row.
      {
        id: "gb_pay_r3",
        reservationId: "gb_res_r3",
        amount: "60.00",
        refundId: "re_r3",
        paymentIntentId: "pi_r3",
      },
      {
        id: "gb_ref_r3",
        reservationId: "gb_res_r3",
        amount: "40.00",
        refundId: "re_r3",
        refundOf: "gb_pay_r3",
      },
      // From 2026-06-18 to 2026-08-20: netted, no row.
      {
        id: "gb_pay_r4",
        reservationId: "gb_res_r4",
        amount: "70.00",
        refundId: "re_r4",
        paymentIntentId: "pi_r4",
      },
    );
    stripe.put("acct_store", "pi_r1", intentOf(chargeOf("ch_r1", 8000, 8000, 8000)));
    stripe.put("acct_store", "pi_r2", intentOf(chargeOf("ch_r2", 10_000, 10_000, 3000)));
    stripe.put("acct_store", "pi_r3", intentOf(chargeOf("ch_r3", 10_000, 10_000, 4000)));
    stripe.put("acct_store", "pi_r4", intentOf(chargeOf("ch_r4", 10_000, 10_000, 3000)));
    const gaps = [
      {
        paymentId: "gb_pay_r1",
        reservationId: "gb_res_r1",
        storeId: STORE,
        stripeRefundedMinor: 8000,
        recordedMinor: 0,
      },
    ];

    const dry = await run(false);
    assert.deepEqual(dry.refundGaps, gaps);

    const applied = await run(true);
    assert.deepEqual(applied.refundGaps, gaps);
    assert.deepEqual(
      (await facts()).map((row) => [row.id, row.gross, row.chargeId]),
      [
        ["gb_pay_r1", 8000, "ch_r1"],
        ["gb_pay_r2", 10_000, "ch_r2"],
        ["gb_pay_r3", 10_000, "ch_r3"],
        ["gb_pay_r4", 10_000, "ch_r4"],
        ["gb_ref_r2", null, "ch_r2"],
        ["gb_ref_r3", null, null],
      ],
    );
    assert.deepEqual(
      events.map(({ level, event }) => `${level} ${event.billing.event}`),
      ["warn gross_backfill", "warn gross_backfill"],
    );
  });

  describe("pnpm billing:gross-backfill", () => {
    /** Where the script starts: a .env that would turn billing on, with a Stripe key. */
    let startDirectory = "";

    before(() => {
      startDirectory = mkdtempSync(join(tmpdir(), "louez-gross-backfill-cli-"));
      writeFileSync(
        join(startDirectory, ".env"),
        "LOUEZ_BILLING=cloud\nSTRIPE_SECRET_KEY=sk_test_sentinel_never_used\n",
      );
      // Loaded first by one test: the script then cannot leave this directory.
      writeFileSync(join(startDirectory, "no-chdir.mjs"), "process.chdir = () => {};\n");
    });
    after(() => {
      if (startDirectory) rmSync(startDirectory, { recursive: true, force: true });
    });

    function runScript(
      args: string[],
      options: { env?: Record<string, string>; cannotLeaveDirectory?: boolean } = {},
    ) {
      // Only what the script needs: no Stripe key, billing switch or database but the target.
      const scriptEnv: NodeJS.ProcessEnv = {
        NODE_ENV: "test",
        TSX_TSCONFIG_PATH: join(APP_ROOT, "tsconfig.json"),
        MIGRATE_DATABASE_URL: database.url,
        ...options.env,
      };
      for (const name of ["PATH", "HOME", "TMPDIR"]) {
        const value = process.env[name];
        if (value !== undefined) scriptEnv[name] = value;
      }
      const preload = options.cannotLeaveDirectory
        ? ["--import", pathToFileURL(join(startDirectory, "no-chdir.mjs")).href]
        : [];
      const result = spawnSync(
        process.execPath,
        ["--import", TSX_LOADER, ...preload, SCRIPT, ...args],
        { cwd: startDirectory, encoding: "utf8", env: scriptEnv, timeout: SCRIPT_TIMEOUT_MS },
      );
      return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
    }

    async function seedCash(): Promise<void> {
      await reservation("gb_res_cli");
      await payment(
        { id: "gb_pay_cli", reservationId: "gb_res_cli", amount: "19.90", method: "cash" },
        {
          id: "gb_pay_cli_2",
          reservationId: "gb_res_cli",
          amount: "5.00",
          method: "transfer",
          type: "damage",
        },
      );
    }

    test("a dry run with no payment to read from Stripe needs no key, and writes nothing", async () => {
      await seedCash();
      const before = await facts();

      const { status, output } = runScript([]);
      assert.equal(status, 0, output);
      assert.match(output, /Gross backfill \(dry run\)/);
      assert.match(output, /Stripe key {15}not set/);
      assert.match(output, /payments missing a fact {2}2 \(1 reservations\)/);
      assert.match(output, /read from Stripe {9}0/);
      assert.match(output, /gross_minor {14}2 \(would fill\)/);
      assert.match(output, /insurance_share_minor {4}2 \(would fill\)/);
      assert.match(output, /gross_backfilled_at {6}would be set/);
      assert.match(output, /Dry run: nothing was written/);
      assert.deepEqual(await facts(), before);
      assert.deepEqual(await select("SELECT id FROM billing_sync_state"), []);
    });

    test("a dry run shows the key's mode, and the stores whose statements would be held", async () => {
      // A three-decimal currency: its cash payment gets no gross.
      await reservation("gb_res_kwd", { currency: "KWD", total: "10.00" });
      await payment({
        id: "gb_pay_kwd",
        reservationId: "gb_res_kwd",
        amount: "10.00",
        method: "cash",
      });

      const { status, output } = runScript([], { env: { STRIPE_SECRET_KEY: "sk_test_stub" } });
      assert.equal(status, 0, output);
      assert.match(output, /Stripe key {15}test mode/);
      assert.match(
        output,
        /gb_pay_kwd {2}reservation gb_res_kwd {2}store gb_store {2}grossMinor: unsupported_currency/,
      );
      assert.match(output, /stores held {14}1\n {5}gb_store {2}1 completed payments without gross/);
      assert.match(
        output,
        /Once gross_backfilled_at is set, the billing service will hold the statements of this store every month \(reason "invariants"\) until their payments get a gross amount or an admin releases each statement/,
      );
    });

    test("a payment that needs Stripe stops it without STRIPE_SECRET_KEY in the shell, whatever a .env says", async () => {
      await seedCases();
      const before = await facts();

      const { status, output } = runScript([]);
      assert.equal(status, 1, output);
      assert.match(output, /7 payments need Stripe: set STRIPE_SECRET_KEY/);
      assert.deepEqual(await facts(), before);
    });

    test("--apply needs LOUEZ_BILLING=cloud in the shell", async () => {
      await seedCash();
      const before = await facts();

      const { status, output } = runScript(["--apply"]);
      assert.equal(status, 1, output);
      assert.match(output, /--apply needs LOUEZ_BILLING=cloud/);
      assert.deepEqual(await facts(), before);
    });

    test("if the script cannot leave its directory, the environment check stops it", async () => {
      await seedCash();
      const before = await facts();

      const { status, output } = runScript(["--apply"], { cannotLeaveDirectory: true });
      assert.equal(status, 1, output);
      assert.match(
        output,
        /Loading the app changed LOUEZ_BILLING, STRIPE_SECRET_KEY: only the shell's variables may count/,
      );
      assert.doesNotMatch(output, /── Gross backfill/);
      assert.deepEqual(await facts(), before);
    });

    test("--apply fills, sets gross_backfilled_at, and a second one changes nothing", async () => {
      await seedCash();
      const env = { LOUEZ_BILLING: "cloud" };

      const first = runScript(["--apply"], { env });
      assert.equal(first.status, 0, first.output);
      assert.match(first.output, /BILLING_SERVICE_URL is not set/);
      assert.match(first.output, /gross_minor {14}2\n/);
      assert.match(first.output, /reservations marked {6}1/);
      assert.match(first.output, /✅ Done/);
      const filled = await facts();
      assert.deepEqual(
        filled.map((row) => [row.id, row.gross, row.share]),
        [
          ["gb_pay_cli", 1990, 0],
          ["gb_pay_cli_2", 500, 0],
        ],
      );
      const at = await backfilledAt();
      assert.notEqual(at, null);

      const second = runScript(["--apply"], { env });
      assert.equal(second.status, 0, second.output);
      assert.match(second.output, /payments missing a fact {2}0 \(0 reservations\)/);
      assert.deepEqual(await facts(), filled);
      assert.equal(await backfilledAt(), at);
    });
  });
});
