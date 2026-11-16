import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

import type { Connection, RowDataPacket } from "mysql2/promise";
import Stripe from "stripe";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

// The Connect webhook's POST, run whole, for an event's account. One unknown to
// Louez (no store holds it, no payment records it) is answered 2xx, nothing
// written, Stripe never asked. Nothing Stripe answers makes the route
// acknowledge an event: every failure of a handler answers 5xx, so Stripe
// sends it again, and when Stripe says the platform has no access to a known
// account, the platform is alerted too. Logs hold no key material. A known
// account Stripe answers goes on as before, and an account connected again
// resumes an event Stripe sends again. The signature check, the deployment's
// keys, the log, the senders and Stripe are replaced; triggers record each
// write.

const directory = mkdtempSync(join(tmpdir(), "louez-connected-account-"));
const stubsPath = join(directory, "stubs.cjs");
writeFileSync(stubsPath, "module.exports = globalThis.__louezConnectedAccountStubs;");
after(() => rmSync(directory, { recursive: true }));

/** What each module of the webhook has replaced, by the module that imports it. */
const STUBBED: Record<string, ReadonlySet<string>> = {
  "/api/webhooks/stripe/connect/route.ts": new Set([
    "next/headers",
    "@/env",
    "@/lib/stripe/client",
    "@/lib/evlog",
    "@/lib/api/effects",
    "@/lib/billing/reservation-effects",
    "@/lib/discord/platform-notifications",
    "@/lib/reservations/deposit-hold-live",
  ]),
  "/api/webhooks/stripe/connect/connected-account.ts": new Set([
    "@/lib/evlog",
    "@/lib/billing-sync/alerts",
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

/** The key's masked tail, as Stripe writes it into a refusal's message. */
const MASKED_KEY = "sk_test_********************abcd";

/** What every Stripe call answers in a case: null, Stripe answers; else this error. */
let stripeFails: Error | null = null;
/** What one Stripe call answers in a case, by its name, before `stripeFails`. */
const failures = new Map<string, Error>();
/** The application fee the charge carries in a case, and what Stripe holds of it. */
let feeOnCharge: string | null = null;
/** The idempotency key of each fee refund asked of Stripe. */
const feeRefundKeys: string[] = [];
/** The refunds Stripe lists for a charge, by its id. */
const refundsOf = new Map<string, ReadonlyArray<Record<string, unknown>>>();

/** A Stripe call: it fails as the case says, else answers. */
const stripeCall =
  <Args extends unknown[], Result>(name: string, answer: (...args: Args) => Result) =>
  async (...args: Args) => {
    calls.push([`stripe.${name}`]);
    const failure = failures.get(name) ?? stripeFails;
    if (failure) throw failure;
    return answer(...args);
  };

const stubs = {
  headers: async () => new Headers({ "stripe-signature": "t=1,v1=test" }),
  env: { STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_test", STRIPE_SECRET_KEY: "sk_test_connected" },
  stripe: {
    webhooks: {
      // The signature is not checked: the body is the event.
      constructEvent: (body: string) => JSON.parse(body),
    },
    paymentIntents: {
      retrieve: stripeCall("paymentIntents.retrieve", (id: string) => ({ id, metadata: {} })),
    },
    refunds: {
      list: (params: { charge: string }) => {
        calls.push(["stripe.refunds.list"]);
        return (async function* () {
          const failure = failures.get("refunds.list") ?? stripeFails;
          if (failure) throw failure;
          yield* refundsOf.get(params.charge) ?? [];
        })();
      },
    },
    applicationFees: {
      retrieve: stripeCall("applicationFees.retrieve", (id: string) => ({
        id,
        amount: 400,
        amount_refunded: 0,
        currency: "eur",
      })),
      createRefund: stripeCall(
        "applicationFees.createRefund",
        (id: string, _params: unknown, options: { idempotencyKey?: string }) => {
          feeRefundKeys.push(options.idempotencyKey ?? "");
          return { id: `fr_${id}` };
        },
      ),
    },
    charges: {
      retrieve: stripeCall("charges.retrieve", (id: string) => ({
        id,
        application_fee: feeOnCharge,
        amount_captured: 8000,
        amount_refunded: feeOnCharge ? 8000 : 0,
        payment_intent: null,
      })),
    },
    disputes: {
      list: () => {
        calls.push(["stripe.disputes.list"]);
        return (async function* () {
          if (stripeFails) throw stripeFails;
          yield* [];
        })();
      },
    },
  },
  log: {
    error: record("log.error"),
    warn: record("log.warn"),
    info: record("log.info"),
    debug: record("log.debug"),
  },
  dispatchApiEffects: record("dispatchApiEffects"),
  runReservationEffects: record("runReservationEffects"),
  notifyStripeConnected: record("notifyStripeConnected"),
  // The platform's alerts, as `connected-account.ts` raises them.
  createBillingAlerts: () => ({ alert: record("alerts.alert") }),
  // Set once the test database exists, before the route is imported.
  depositHoldDeps: null as unknown,
};
Reflect.set(globalThis, "__louezConnectedAccountStubs", stubs);

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

const STORE = "store_connected_acct";
const ACCOUNT = "acct_connected_known";
const UNKNOWN = "acct_connected_unknown";

const TRX = `(SELECT CONCAT(THREAD_ID, ':', EVENT_ID) FROM performance_schema.events_transactions_current WHERE THREAD_ID = PS_CURRENT_THREAD_ID())`;
const WRITE_LOG = [
  `CREATE TABLE test_writes (
     seq INT AUTO_INCREMENT PRIMARY KEY,
     trx VARCHAR(32) NOT NULL,
     entry VARCHAR(255) NOT NULL
   )`,
  `CREATE TRIGGER test_writes_payments_insert AFTER INSERT ON payments FOR EACH ROW
     INSERT INTO test_writes (trx, entry)
     VALUES (${TRX}, CONCAT('payments + ', NEW.payment_type, ' ', NEW.payment_status))`,
  `CREATE TRIGGER test_writes_payments AFTER UPDATE ON payments FOR EACH ROW
     INSERT INTO test_writes (trx, entry)
     VALUES (${TRX}, CONCAT('payments ', NEW.payment_type, ' ', OLD.payment_status, ' > ', NEW.payment_status))`,
  `CREATE TRIGGER test_writes_activity AFTER INSERT ON reservation_activity FOR EACH ROW
     INSERT INTO test_writes (trx, entry)
     VALUES (${TRX}, CONCAT('reservation_activity + ', NEW.activity_type))`,
  `CREATE TRIGGER test_writes_reservations AFTER UPDATE ON reservations FOR EACH ROW
     INSERT INTO test_writes (trx, entry) VALUES (${TRX}, 'reservations')`,
  `CREATE TRIGGER test_writes_effects AFTER INSERT ON api_effects FOR EACH ROW
     INSERT INTO test_writes (trx, entry) VALUES (${TRX}, CONCAT('api_effects + ', NEW.type))`,
];

/** Stripe refuses the platform that account: its 403, with the key's masked tail in its message. */
const refused = () =>
  new Stripe.errors.StripePermissionError({
    type: "invalid_request_error",
    code: "account_invalid",
    statusCode: 403,
    requestId: "req_refused",
    message: `The provided key '${MASKED_KEY}' does not have access to account '${ACCOUNT}' (or that account does not exist). Application access may have been revoked.`,
  });

/** Failures that may pass, each with the answer Stripe gives it. */
const TRANSIENT: ReadonlyArray<readonly [label: string, error: () => Error]> = [
  [
    "the platform's restricted key lacking a permission (a 403 that names no account)",
    () =>
      new Stripe.errors.StripePermissionError({
        type: "invalid_request_error",
        statusCode: 403,
        requestId: "req_restricted",
        message: `The provided key '${MASKED_KEY}' does not have the required permissions for this endpoint on account '${ACCOUNT}'.`,
      }),
  ],
  [
    "a rate limit",
    () =>
      new Stripe.errors.StripeRateLimitError({
        type: "rate_limit_error",
        statusCode: 429,
        message: "Too many requests",
      }),
  ],
  [
    "the network",
    () =>
      new Stripe.errors.StripeConnectionError({
        type: "api_error",
        message: "An error occurred with our connection to Stripe.",
      }),
  ],
  [
    "Stripe's own failure",
    () =>
      new Stripe.errors.StripeAPIError({
        type: "api_error",
        statusCode: 500,
        message: "Something went wrong on Stripe's end.",
      }),
  ],
  [
    "the platform's own key refused",
    () =>
      new Stripe.errors.StripeAuthenticationError({
        type: "authentication_error",
        statusCode: 401,
        message: `Invalid API Key provided: ${MASKED_KEY}`,
      }),
  ],
  ["any other error", () => new Error("Connection lost: The server closed the connection.")],
];

describe(
  "a Connect event Louez cannot act on (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    let database: TestDatabase;
    let raw: Connection;
    let louezDb: typeof import("@louez/db");
    let route: typeof import("./route");
    let counter = 0;

    before(async () => {
      database = await createTestDatabase("connected_account");
      louezDb = await import("@louez/db");
      stubs.depositHoldDeps = {
        database: louezDb.db,
        stripe: {
          readIntent: stripeCall("readIntent", () => {
            throw new Error("no deposit intent in this suite");
          }),
        },
        dispatchEffects: record("dispatchEffects"),
      };
      route = await import("./route");

      raw = await database.connect();
      for (const statement of WRITE_LOG) await raw.query(statement);

      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: "owner",
        name: "Connected account",
        slug: "connected-account",
        stripeAccountId: ACCOUNT,
        stripeChargesEnabled: true,
      });
    });

    after(async () => {
      await raw?.end();
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      calls.length = 0;
      stripeFails = null;
      failures.clear();
      feeOnCharge = null;
      feeRefundKeys.length = 0;
      refundsOf.clear();
      await raw.query("TRUNCATE TABLE test_writes");
    });

    const nextId = (prefix: string) => `${prefix}_${++counter}`;

    /** A pending booking with a deposit; its id is 21 characters, as a nanoid is. */
    async function booking() {
      const id = `res_acct_${String(++counter).padStart(12, "0")}`;
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

    /** The rental payment of the reservation, completed with its charge on the account. */
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

    const refundedCharge: Setup = async (reservationId) => {
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
        application_fee: "fee_connected_account",
        metadata: {},
      };
    };

    const failedRefund: Setup = async (reservationId) => {
      const { paymentIntentId, chargeId } = await paidCharge(reservationId);
      return {
        id: nextId("re"),
        object: "refund",
        amount: 2000,
        created: 1_800_000_000,
        currency: "eur",
        status: "failed",
        failure_reason: "expired_or_canceled_card",
        charge: chargeId,
        payment_intent: paymentIntentId,
        metadata: {},
      };
    };

    const dispute: Setup = async (reservationId) => {
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

    /** Every type read on the connected account that reads Stripe before it writes. */
    /** A deposit hold the reservation records, and its PaymentIntent. */
    const depositHold: Setup = async (reservationId) => {
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
      return {
        id: paymentIntentId,
        object: "payment_intent",
        amount: 5000,
        currency: "eur",
        capture_method: "manual",
        metadata: { reservationId, type: "deposit_hold" },
      };
    };

    const EVENTS: ReadonlyArray<readonly [type: string, setup: Setup]> = [
      ["charge.refunded", refundedCharge],
      ["refund.failed", failedRefund],
      ["refund.updated", failedRefund],
      ["charge.refund.updated", failedRefund],
      ["charge.dispute.created", dispute],
      ["charge.dispute.closed", dispute],
      [
        "checkout.session.completed",
        async (reservationId) => ({
          id: nextId("cs"),
          object: "checkout.session",
          mode: "payment",
          payment_intent: nextId("pi"),
          amount_total: 8000,
          currency: "eur",
          metadata: { reservationId },
        }),
      ],
      ["payment_intent.succeeded", depositHold],
      // A deposit hold's failed attempt: its branch reads the PaymentIntent on the account.
      ["payment_intent.payment_failed", depositHold],
    ];

    /** The id of the last event sent. */
    let lastEventId = "";
    async function send(type: string, object: Record<string, unknown>, account: string) {
      lastEventId = nextId("evt");
      const response = await route.POST(
        new Request("https://louez.test/api/webhooks/stripe/connect", {
          method: "POST",
          body: JSON.stringify({
            id: lastEventId,
            type,
            livemode: false,
            account,
            created: 1_800_000_000,
            data: { object },
          }),
        }),
      );
      return { status: response.status, body: await response.json() };
    }

    async function writes() {
      const [rows] = await raw.query<RowDataPacket[]>("SELECT entry FROM test_writes ORDER BY seq");
      return rows.map((row) => String(row.entry));
    }

    const logs = () => calls.filter(([name]) => name.startsWith("log."));
    const stripeCalls = () => calls.filter(([name]) => name.startsWith("stripe."));

    for (const [type, setup] of EVENTS) {
      test(`${type}: a known account Stripe says the platform cannot reach answers 5xx, writes nothing, and alerts the platform`, async () => {
        const object = await setup(await booking());
        await raw.query("TRUNCATE TABLE test_writes");
        calls.length = 0;
        // Every read of the account answers that the platform has no access to it.
        stripeFails = refused();

        const answer = await send(type, object, ACCOUNT);

        assert.equal(answer.status, 500, type);
        assert.deepEqual(await writes(), [], type);
        const failed = logs().filter(([, entry]) =>
          JSON.stringify(entry).includes("handler_failed"),
        );
        assert.equal(failed.length, 1, "the handler's failure is logged once");
        // Diagnosable without any message: the event and the account it came from.
        assert.match(
          JSON.stringify(failed[0]),
          new RegExp(`"stripeEventId":"${lastEventId}","accountId":"${ACCOUNT}"`),
        );
        // An account Louez holds payments of: the platform hears of it.
        const alerts = calls.filter(([name]) => name === "alerts.alert");
        assert.equal(alerts.length, 1, type);
        assert.equal(alerts[0]?.[1], "connected_account_unreachable");
        assert.match(String(alerts[0]?.[2]), new RegExp(`${ACCOUNT} of store ${STORE}`));
        assert.match(String(alerts[0]?.[2]), new RegExp(`event ${lastEventId} failed`));
        assert.doesNotMatch(JSON.stringify(calls), /sk_test_|abcd/);
      });

      test(`${type}: an account Louez does not know is acknowledged, nothing written, Stripe never asked`, async () => {
        const object = await setup(await booking());
        await raw.query("TRUNCATE TABLE test_writes");
        calls.length = 0;

        const answer = await send(type, object, UNKNOWN);

        assert.deepEqual(answer, { status: 200, body: { received: true } });
        assert.deepEqual(await writes(), [], type);
        assert.deepEqual(stripeCalls(), []);
        assert.deepEqual(logs(), [
          [
            "log.warn",
            {
              stripeWebhook: {
                event: type,
                issue: "account_unknown",
                stripeEventId: lastEventId,
                accountId: UNKNOWN,
              },
            },
          ],
        ]);
      });
    }

    for (const [label, error] of TRANSIENT) {
      test(`charge.refunded: ${label} answers 5xx, so Stripe sends it again, and logs no message of Stripe's`, async () => {
        const object = await refundedCharge(await booking());
        await raw.query("TRUNCATE TABLE test_writes");
        calls.length = 0;
        stripeFails = error();

        const answer = await send("charge.refunded", object, ACCOUNT);

        assert.equal(answer.status, 500);
        assert.deepEqual(await writes(), []);
        const [line, ...others] = logs();
        assert.deepEqual(others, []);
        assert.equal(line?.[0], "log.error");
        assert.match(JSON.stringify(line), /"issue":"handler_failed"/);
        assert.doesNotMatch(JSON.stringify(calls), /sk_test_|abcd/);
        assert.deepEqual(
          calls.filter(([name]) => name === "alerts.alert"),
          [],
          "only an account the platform cannot reach is alerted",
        );
      });
    }

    test("charge.refunded: an account lost after the handler sent something is never acknowledged, and is recorded once connected again", async () => {
      const reservationId = await booking();
      const object = await refundedCharge(reservationId);
      feeOnCharge = String(object.application_fee);
      const refundsWritten = async () =>
        (await writes()).filter((entry) => entry.startsWith("payments + "));

      // First delivery: the fee given back at source goes, then the listing of
      // the customer's refunds is refused.
      failures.set("refunds.list", refused());
      await raw.query("TRUNCATE TABLE test_writes");
      calls.length = 0;
      assert.equal((await send("charge.refunded", object, ACCOUNT)).status, 500);
      assert.ok(
        stripeCalls().some(([name]) => name === "stripe.applicationFees.createRefund"),
        "the fee refund went before the refusal",
      );
      assert.deepEqual(await refundsWritten(), []);

      // The store's access is revoked, then Stripe delivers again: still 5xx,
      // nothing false written, and the platform is alerted.
      failures.clear();
      stripeFails = refused();
      calls.length = 0;
      assert.equal((await send("charge.refunded", object, ACCOUNT)).status, 500);
      assert.deepEqual(await refundsWritten(), []);
      assert.equal(calls.filter(([name]) => name === "alerts.alert").length, 1);

      // Connected again, Stripe delivers once more: the fee refund is asked again
      // under the same idempotency key, which Stripe runs once, and the refund is recorded.
      stripeFails = null;
      refundsOf.set(String(object.id), [
        {
          id: nextId("re"),
          object: "refund",
          amount: 8000,
          created: 1_800_000_000,
          currency: "eur",
          status: "succeeded",
          metadata: {},
        },
      ]);
      calls.length = 0;
      const again = await send("charge.refunded", object, ACCOUNT);
      assert.deepEqual(again, { status: 200, body: { received: true } });
      assert.deepEqual(await refundsWritten(), ["payments + rental completed"]);
      assert.equal(feeRefundKeys.length, 2);
      assert.equal(feeRefundKeys[0], feeRefundKeys[1]);
    });

    test("charge.refunded: a known account Stripe answers is recorded as before", async () => {
      const reservationId = await booking();
      const object = await refundedCharge(reservationId);
      refundsOf.set(String(object.id), [
        {
          id: nextId("re"),
          object: "refund",
          amount: 8000,
          created: 1_800_000_000,
          currency: "eur",
          status: "succeeded",
          metadata: {},
        },
      ]);
      await raw.query("TRUNCATE TABLE test_writes");
      calls.length = 0;

      const answer = await send("charge.refunded", { ...object, application_fee: null }, ACCOUNT);

      assert.deepEqual(answer, { status: 200, body: { received: true } });
      const written = await writes();
      assert.ok(written.includes("payments + rental completed"), written.join("\n"));
      assert.ok(written.includes("reservation_activity + payment_updated"), written.join("\n"));
      assert.equal(
        logs().some(([, entry]) => JSON.stringify(entry).includes("account_")),
        false,
        "no account issue logged",
      );
    });
  },
);
