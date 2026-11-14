import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import type { Connection, RowDataPacket } from "mysql2/promise";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { DepositIntent } from "@/lib/reservations/util.deposit-hold-transition";

// The Connect webhook's POST, run whole, for an event of the other mode than the
// deployment's key (docs/domain/reservation-changes.md, 6a-W1): the route refuses it
// before any handler, whatever its type, logs it with the id of its object, writes
// nothing, sends nothing, calls no Stripe API, and answers 2xx. Each case sets the
// rows its handler would write in the deployment's mode: a deposit hold, a paid
// charge, a connected store.
// `checkout-completed.db.test.ts`, `checkout-expired.db.test.ts` and
// `payment-failed.db.test.ts` hold the same case for their events. The signature
// check, the deployment's keys, the log, the fee runner, the senders and Stripe are
// replaced; Stripe fails on any call. Triggers record each write.

const directory = mkdtempSync(join(tmpdir(), "louez-deployment-mode-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezDeploymentModeStubs;");
after(() => rmSync(directory, { recursive: true }));

/** What each module of the webhook has replaced, by the module that imports it. */
const STUBBED: Record<string, ReadonlySet<string>> = {
  "/api/webhooks/stripe/connect/route.ts": new Set([
    "next/headers",
    "@/env",
    "@/lib/stripe/client",
    "@/lib/evlog",
    "@/lib/billing/reservation-effects",
    "@/lib/discord/platform-notifications",
    "@/lib/reservations/deposit-hold-live",
  ]),
  "/api/webhooks/stripe/connect/deposit-events.ts": new Set(["@/lib/evlog"]),
  "/api/webhooks/stripe/connect/charge-refund.ts": new Set(["@/lib/evlog", "@/lib/stripe/client"]),
  "/api/webhooks/stripe/connect/charge-dispute.ts": new Set(["@/lib/evlog"]),
  "/api/webhooks/stripe/connect/fee-reversal.ts": new Set(["@/lib/stripe/client"]),
};

type Call = [name: string, ...args: unknown[]];
const calls: Call[] = [];
const record =
  (name: string) =>
  (...args: unknown[]) => {
    calls.push([name, ...structuredClone(args)]);
  };

const TEST_KEY = "sk_test_deployment_mode";
const LIVE_KEY = "sk_live_deployment_mode";
/** The deployment's keys, as the route reads them; a case sets the secret key. */
const env = { STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_test", STRIPE_SECRET_KEY: TEST_KEY };

/** What Stripe answers for a deposit hold's PaymentIntent, by its id; a case sets it. */
const intents = new Map<string, DepositIntent>();
const unexpected =
  (name: string) =>
  (...args: unknown[]) => {
    calls.push([name, ...structuredClone(args)]);
    throw new Error(`Unexpected call: ${name}`);
  };

const stubs = {
  headers: async () => new Headers({ "stripe-signature": "t=1,v1=test" }),
  env,
  stripe: {
    webhooks: {
      // The signature is not checked: the body is the event.
      constructEvent: (body: string) => JSON.parse(body),
    },
    paymentIntents: { retrieve: unexpected("stripe.paymentIntents.retrieve") },
    refunds: { list: unexpected("stripe.refunds.list") },
    applicationFees: {
      retrieve: unexpected("stripe.applicationFees.retrieve"),
      createRefund: unexpected("stripe.applicationFees.createRefund"),
    },
    charges: { retrieve: unexpected("stripe.charges.retrieve") },
  },
  log: { error: record("log.error"), warn: record("log.warn"), info: record("log.info") },
  runReservationEffects: record("runReservationEffects"),
  notifyStripeConnected: unexpected("notifyStripeConnected"),
  // Set once the test database exists, before the route is imported.
  depositHoldDeps: null as unknown,
};
Reflect.set(globalThis, "__louezDeploymentModeStubs", stubs);

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
    for (const [module, replaced] of Object.entries(STUBBED)) {
      if (parent.endsWith(module) && replaced.has(specifier)) {
        return { url: pathToFileURL(stubsPath).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
});

const STORE = "store_deploy_mode";
const ACCOUNT = "acct_deployment_mode";

const TRX = `(SELECT CONCAT(THREAD_ID, ':', EVENT_ID) FROM performance_schema.events_transactions_current WHERE THREAD_ID = PS_CURRENT_THREAD_ID())`;
const WRITE_LOG = [
  `CREATE TABLE test_writes (
     seq INT AUTO_INCREMENT PRIMARY KEY,
     trx VARCHAR(32) NOT NULL,
     row_id VARCHAR(64) NOT NULL,
     entry VARCHAR(255) NOT NULL
   )`,
  `CREATE TRIGGER test_writes_payments_insert AFTER INSERT ON payments FOR EACH ROW
     INSERT INTO test_writes (trx, row_id, entry)
     VALUES (${TRX}, NEW.reservation_id, CONCAT('payments + ', NEW.payment_type, ' ', NEW.payment_status))`,
  `CREATE TRIGGER test_writes_payments AFTER UPDATE ON payments FOR EACH ROW
     INSERT INTO test_writes (trx, row_id, entry)
     VALUES (${TRX}, NEW.reservation_id, CONCAT('payments ', NEW.payment_type, ' ', OLD.payment_status, ' > ', NEW.payment_status))`,
  `CREATE TRIGGER test_writes_activity AFTER INSERT ON reservation_activity FOR EACH ROW
     INSERT INTO test_writes (trx, row_id, entry)
     VALUES (${TRX}, NEW.reservation_id, CONCAT('reservation_activity + ', NEW.activity_type))`,
  `CREATE TRIGGER test_writes_reservations AFTER UPDATE ON reservations FOR EACH ROW
     INSERT INTO test_writes (trx, row_id, entry)
     VALUES (${TRX}, NEW.id, 'reservations')`,
  `CREATE TRIGGER test_writes_stores AFTER UPDATE ON stores FOR EACH ROW
     INSERT INTO test_writes (trx, row_id, entry)
     VALUES (${TRX}, NEW.id, 'stores')`,
];

describe("an event of the other mode (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let raw: Connection;
  let louezDb: typeof import("@louez/db");
  let route: typeof import("./route");
  let counter = 0;

  before(async () => {
    database = await createTestDatabase("deployment_mode");
    louezDb = await import("@louez/db");
    stubs.depositHoldDeps = {
      database: louezDb.db,
      stripe: {
        readIntent: async (accountId: string, paymentIntentId: string) => {
          calls.push(["stripe.readIntent", accountId, paymentIntentId]);
          const intent = intents.get(paymentIntentId);
          if (!intent) throw new Error(`No such payment_intent: ${paymentIntentId}`);
          return intent;
        },
        authorize: unexpected("authorize"),
        cardCustomer: unexpected("cardCustomer"),
        listCustomerIntents: unexpected("listCustomerIntents"),
        capture: unexpected("capture"),
        release: unexpected("release"),
      },
      dispatchEffects: record("dispatchEffects"),
    };
    route = await import("./route");

    raw = await database.connect();
    for (const statement of WRITE_LOG) await raw.query(statement);

    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: "owner",
      name: "Deployment mode",
      slug: "deployment-mode",
      stripeAccountId: ACCOUNT,
      stripeChargesEnabled: true,
      stripeOnboardingComplete: false,
    });
  });

  after(async () => {
    await raw?.end();
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    calls.length = 0;
    intents.clear();
    env.STRIPE_SECRET_KEY = TEST_KEY;
    await raw.query("TRUNCATE TABLE test_writes");
  });

  const nextId = (prefix: string) => `${prefix}_${++counter}`;

  /** A pending booking with a deposit; its id is 21 characters, as a nanoid is. */
  async function booking() {
    const id = `res_mode_${String(++counter).padStart(12, "0")}`;
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: STORE,
      customerId: "customer",
      number: id,
      status: "pending",
      startDate: new Date("2027-02-01T09:00:00Z"),
      endDate: new Date("2027-02-03T09:00:00Z"),
      subtotalAmount: "80.00",
      depositAmount: "50.00",
      depositStatus: "pending",
      totalAmount: "80.00",
      currency: "EUR",
      source: "online",
    });
    return id;
  }

  /** A deposit hold pending on the reservation, and Stripe's answer for it once authorized. */
  async function depositHold(reservationId: string) {
    const paymentIntentId = nextId("pi");
    await louezDb.db.insert(louezDb.payments).values({
      id: nextId("pay"),
      reservationId,
      amount: "50.00",
      type: "deposit_hold",
      method: "stripe",
      status: "pending",
      stripePaymentIntentId: paymentIntentId,
      stripeAccountId: ACCOUNT,
      currency: "EUR",
      grossMinor: 5000,
    });
    intents.set(paymentIntentId, {
      paymentIntentId,
      status: "requires_capture",
      amountMinor: 5000,
      capturedMinor: 0,
      currency: "EUR",
      captureBefore: null,
      captureMethod: "manual",
      customerId: null,
      paymentMethodId: null,
      chargeId: null,
      attemptId: null,
      reservationId,
    });
    return paymentIntentId;
  }

  /** The rental payment of the reservation, completed with its charge. */
  async function paidCharge(reservationId: string) {
    const paymentIntentId = nextId("pi");
    const chargeId = nextId("ch");
    await louezDb.db.insert(louezDb.payments).values({
      id: nextId("pay"),
      reservationId,
      amount: "80.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      stripePaymentIntentId: paymentIntentId,
      stripeChargeId: chargeId,
      stripeAccountId: ACCOUNT,
      currency: "EUR",
    });
    return { paymentIntentId, chargeId };
  }

  /** The event's object, on the rows a case sets. */
  type Setup = (reservationId: string) => Promise<Record<string, unknown>>;

  const depositEvent: Setup = async (reservationId) => {
    const paymentIntentId = await depositHold(reservationId);
    return {
      id: paymentIntentId,
      object: "payment_intent",
      amount: 5000,
      currency: "eur",
      capture_method: "manual",
      metadata: { reservationId, type: "deposit_hold" },
    };
  };

  const disputeEvent: Setup = async (reservationId) => {
    const { paymentIntentId, chargeId } = await paidCharge(reservationId);
    return {
      id: nextId("dp"),
      object: "dispute",
      charge: chargeId,
      payment_intent: paymentIntentId,
      amount: 8000,
      currency: "eur",
      status: "needs_response",
      reason: "fraudulent",
      created: 1_800_000_000,
      evidence_details: { due_by: 1_800_600_000 },
      balance_transactions: [],
    };
  };

  /** Each type the route handles, and one it does not. */
  const EVENTS: ReadonlyArray<readonly [type: string, setup: Setup]> = [
    ["payment_intent.amount_capturable_updated", depositEvent],
    ["payment_intent.succeeded", depositEvent],
    ["payment_intent.canceled", depositEvent],
    [
      "payment_intent.payment_failed",
      async (reservationId) => ({
        id: nextId("pi"),
        object: "payment_intent",
        amount: 8000,
        currency: "eur",
        metadata: { reservationId },
        last_payment_error: { message: "Your card was declined.", code: "card_declined" },
      }),
    ],
    [
      "charge.refunded",
      async (reservationId) => {
        const { paymentIntentId, chargeId } = await paidCharge(reservationId);
        return {
          id: chargeId,
          object: "charge",
          amount: 8000,
          amount_captured: 8000,
          amount_refunded: 8000,
          captured: true,
          refunded: true,
          currency: "eur",
          payment_intent: paymentIntentId,
          application_fee: null,
          metadata: {},
        };
      },
    ],
    ["charge.dispute.created", disputeEvent],
    ["charge.dispute.updated", disputeEvent],
    ["charge.dispute.closed", disputeEvent],
    ["charge.dispute.funds_withdrawn", disputeEvent],
    ["charge.dispute.funds_reinstated", disputeEvent],
    [
      "account.updated",
      async () => ({
        id: ACCOUNT,
        object: "account",
        charges_enabled: true,
        details_submitted: true,
      }),
    ],
    [
      "account.application.deauthorized",
      async () => ({ id: "ca_deployment_mode", object: "application" }),
    ],
    ["customer.created", async () => ({ id: "cus_deployment_mode", object: "customer" })],
  ];

  async function send(type: string, object: Record<string, unknown>, livemode: boolean) {
    const eventId = nextId("evt");
    const response = await route.POST(
      new Request("https://louez.test/api/webhooks/stripe/connect", {
        method: "POST",
        body: JSON.stringify({
          id: eventId,
          type,
          livemode,
          account: ACCOUNT,
          created: 1_800_000_000,
          data: { object },
        }),
      }),
    );
    return { eventId, answer: { status: response.status, body: await response.json() } };
  }

  /** The writes since the case began, on the reservation and on the store. */
  async function readWrites(reservationId: string) {
    const [rows] = await raw.query<RowDataPacket[]>(
      "SELECT entry FROM test_writes WHERE row_id IN (?, ?) ORDER BY seq",
      [reservationId, STORE],
    );
    return rows.map((row) => String(row.entry));
  }

  for (const [type, setup] of EVENTS) {
    test(`${type}: a live event under a test key and a test event under a live key are refused before any handler, nothing written, sent or asked of Stripe`, async () => {
      for (const [secretKey, livemode] of [
        [TEST_KEY, true],
        [LIVE_KEY, false],
      ] as const) {
        env.STRIPE_SECRET_KEY = secretKey;
        const id = await booking();
        const object = await setup(id);
        await raw.query("TRUNCATE TABLE test_writes");
        calls.length = 0;

        const { eventId, answer } = await send(type, object, livemode);

        assert.deepEqual(answer, { status: 200, body: { received: true } });
        assert.deepEqual(await readWrites(id), [], `${type}, livemode ${livemode}`);
        assert.deepEqual(calls, [
          [
            "log.error",
            {
              stripeWebhook: {
                event: type,
                issue: "livemode_mismatch",
                stripeEventId: eventId,
                objectId: object.id,
                accountId: ACCOUNT,
                livemode,
              },
            },
          ],
        ]);
      }
    });
  }
});
