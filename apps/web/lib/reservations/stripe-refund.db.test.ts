import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as nodeModule from "node:module";
import { createRequire } from "node:module";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";

import { and, asc, eq, sql } from "drizzle-orm";

import type { ApiEffectSenders, EffectSendContext } from "@louez/api/platform/effects";
import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type {
  ChargeRefundStripe,
  RefundedChargeEvent,
} from "@/app/api/webhooks/stripe/connect/charge-refund";
import { closeNetworkForSuite, withoutProviderSettings } from "@/lib/testing/network-guard";

import type { RefundRequestInput, StripeRefundDeps } from "./stripe-refund";
import {
  type ProviderRefund,
  REFUND_OPERATION_METADATA,
  type RefundAnswer,
  type StripeRefundPort,
  providerRefundFromStripe,
  refundIdempotencyKey,
} from "./stripe-refund-stripe";

// A refund of an online payment on a migrated database, with Stripe faked and the
// network closed: whatever fails, is retried, or is heard twice, one operation makes
// one refund at Stripe, and one refund row, one netting of the payment, one credit
// note and one fee reversal are written for it. The fake keeps Stripe's idempotency:
// a key it remembers answers for its first request; one it forgot makes a new refund,
// so a send after the key's life shows as a second refund.

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// The invoice PDF imports "server-only", which throws outside Next.
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

// The referral clawback is not under test; its module imports "server-only" through
// require, which the hook above does not reach.
mock.module("@/lib/referral/rewards", {
  namedExports: { clawbackReferrerRewardForQualifyingPayment: async () => {} },
});
// The credit note's own document (a PDF, its storage) is not under test here: the
// sender is given its issuer in each test that runs it.
mock.module("@/lib/invoicing/refund-credit-note", {
  namedExports: {
    issueRefundCreditNote: async () => {
      throw new Error("no credit note is issued in this suite");
    },
  },
});

// Under module mocks, @louez/utils is loaded through require for the API's services.
mock.module("@louez/utils", { namedExports: createRequire(import.meta.url)("@louez/utils") });

closeNetworkForSuite();
withoutProviderSettings();

const STORE = "store_stripe_refund";
const OTHER_STORE = "store_refund_other";
const ACCOUNT = "acct_stripe_refund";
const OTHER_ACCOUNT = "acct_stripe_refund_other";
// Named locks (the fee reversal's) are server-wide: other suites must not share them.
const RUN = randomBytes(4).toString("hex");
const FEE_MINOR = 300;

/** Refund ids are Stripe's: unique across the suite, whichever fake made them. */
let sequence = 0;

const noClaim: Pick<EffectSendContext, "assertClaim" | "throwIfAborted"> = {
  assertClaim: async () => {},
  throwIfAborted: () => {},
};

type FakeRefund = {
  id: string;
  amount: number;
  created: number;
  status: string;
  metadata: Record<string, string>;
  failure_reason: string | null;
};
type FakeCharge = {
  id: string;
  accountId: string;
  /** Lower case, as Stripe writes it. */
  currency: string;
  amount: number;
  captured: number;
  /** Newest first, as Stripe lists them. */
  refunds: FakeRefund[];
};
type Behaviour =
  | "ok"
  /** The request never reached Stripe: nothing made, and the key not seen. */
  | "timeout_before"
  /** Stripe made the refund; its answer was lost. */
  | "lost_after"
  /** A Stripe 500, stored for the key. */
  | "error_500"
  | { readonly refuse: string };

/** Stripe's refunds, as far as Louez sees them, with Stripe's idempotency. */
function fakeStripe() {
  const charges = new Map<string, FakeCharge>();
  const keys = new Map<
    string,
    { kind: "refund"; refundId: string } | { kind: "refused"; code: string } | { kind: "error_500" }
  >();
  const creates: Array<{ key: string; chargeId: string; amount: number }> = [];
  const behaviours: Behaviour[] = [];
  const failures = {
    readCharge: 0,
    list: 0,
    incompleteListing: false,
    /** A refund the charge counts and its listing does not show. */
    hiddenRefundedMinor: 0,
  };
  /** How many refunds a page lists. */
  const listing = { pageSize: 100 };
  const feeRefunds: Array<{ feeId: string; amount: number }> = [];

  const chargeOf = (accountId: string, chargeId: string) => {
    const charge = charges.get(chargeId);
    if (!charge || charge.accountId !== accountId) throw new Error(`No such charge: ${chargeId}`);
    return charge;
  };
  const movedMinor = (charge: FakeCharge) =>
    charge.refunds
      .filter((refund) => refund.status !== "failed" && refund.status !== "canceled")
      .reduce((sum, refund) => sum + refund.amount, 0);
  const asProvider = (charge: FakeCharge, refund: FakeRefund): ProviderRefund =>
    providerRefundFromStripe({ ...refund, currency: charge.currency });
  const indeterminate = (replayed: boolean): RefundAnswer => ({
    kind: "indeterminate",
    replayed,
    message: "Request aborted due to timeout",
  });

  const port: StripeRefundPort = {
    async readCharge(accountId, chargeId) {
      const charge = chargeOf(accountId, chargeId);
      if (failures.readCharge > 0) {
        failures.readCharge--;
        throw new Error("Stripe could not be read");
      }
      return {
        chargeId,
        amountCapturedMinor: charge.captured,
        amountRefundedMinor: movedMinor(charge) + failures.hiddenRefundedMinor,
        currency: charge.currency.toUpperCase(),
      };
    },
    async createRefund(request, key) {
      creates.push({ key, chargeId: request.chargeId, amount: request.amountMinor });
      const charge = chargeOf(request.accountId, request.chargeId);
      const stored = keys.get(key);
      if (stored?.kind === "refund") {
        const refund = charge.refunds.find((candidate) => candidate.id === stored.refundId);
        if (!refund) throw new Error("the fake lost a refund");
        return { kind: "created", refund: asProvider(charge, refund) };
      }
      if (stored?.kind === "refused") {
        return { kind: "refused", code: stored.code, message: `Refused: ${stored.code}` };
      }
      if (stored?.kind === "error_500") return indeterminate(true);

      const behaviour = behaviours.shift() ?? "ok";
      if (behaviour === "timeout_before") return indeterminate(false);
      if (behaviour === "error_500") {
        keys.set(key, { kind: "error_500" });
        return indeterminate(false);
      }
      if (typeof behaviour === "object") {
        keys.set(key, { kind: "refused", code: behaviour.refuse });
        return { kind: "refused", code: behaviour.refuse, message: `Refused: ${behaviour.refuse}` };
      }
      if (request.amountMinor > charge.captured - movedMinor(charge)) {
        keys.set(key, { kind: "refused", code: "amount_too_large" });
        return { kind: "refused", code: "amount_too_large", message: "Refused: amount_too_large" };
      }
      const refund: FakeRefund = {
        id: `re_${RUN}_${++sequence}`,
        amount: request.amountMinor,
        created: Math.floor(Date.now() / 1000),
        status: "succeeded",
        metadata: {
          [REFUND_OPERATION_METADATA]: request.operationId,
          reservationId: request.reservationId,
        },
        failure_reason: null,
      };
      charge.refunds.unshift(refund);
      keys.set(key, { kind: "refund", refundId: refund.id });
      if (behaviour === "lost_after") return indeterminate(false);
      return { kind: "created", refund: asProvider(charge, refund) };
    },
    async listChargeRefunds({ accountId, chargeId, startingAfter }) {
      const charge = chargeOf(accountId, chargeId);
      if (failures.list > 0) {
        failures.list--;
        throw new Error("Stripe could not be listed");
      }
      if (failures.incompleteListing) return { refunds: [], hasMore: true };
      // Newest first, after the cursor, one page at a time.
      const from = startingAfter
        ? charge.refunds.findIndex((refund) => refund.id === startingAfter) + 1
        : 0;
      if (startingAfter && from === 0) throw new Error(`No such refund: ${startingAfter}`);
      const page = charge.refunds.slice(from, from + listing.pageSize);
      return {
        refunds: page.map((refund) => asProvider(charge, refund)),
        hasMore: from + page.length < charge.refunds.length,
      };
    },
  };

  /** The Connect webhook's Stripe: the charge's refunds as the API lists them, and the fee. */
  const webhookPort: ChargeRefundStripe = {
    async listRefunds(chargeId, accountId) {
      return chargeOf(accountId, chargeId).refunds.map((refund) => ({ ...refund }));
    },
    async paymentIntentMetadata() {
      return {};
    },
    feeReversal: {
      async retrieveCharge(chargeId, accountId) {
        const charge = chargeOf(accountId, chargeId);
        return {
          id: chargeId,
          amount: charge.amount,
          amount_captured: charge.captured,
          amount_refunded: movedMinor(charge),
          application_fee: `fee_${chargeId}`,
          payment_intent: null,
        };
      },
      async retrieveApplicationFee(feeId) {
        const refunded = feeRefunds
          .filter((refund) => refund.feeId === feeId)
          .reduce((sum, refund) => sum + refund.amount, 0);
        return { id: feeId, amount: FEE_MINOR, amount_refunded: refunded };
      },
      async listDisputes() {
        return [];
      },
      async refundApplicationFee(feeId, amount) {
        feeRefunds.push({ feeId, amount });
      },
    },
  };

  /** `charge.refunded` for the charge as Stripe has it now. */
  const refundedEvent = (chargeId: string): RefundedChargeEvent => {
    const charge = charges.get(chargeId);
    if (!charge) throw new Error(`No such charge: ${chargeId}`);
    const refunded = movedMinor(charge);
    return {
      id: chargeId,
      amount: charge.amount,
      amount_captured: charge.captured,
      amount_refunded: refunded,
      captured: true,
      refunded: refunded >= charge.captured,
      currency: charge.currency,
      payment_intent: null,
      application_fee: `fee_${chargeId}`,
      metadata: {},
    };
  };

  /** A refund made in Stripe's own dashboard: no operation names it. */
  const refundInDashboard = (chargeId: string, amount: number) => {
    const charge = charges.get(chargeId);
    if (!charge) throw new Error(`No such charge: ${chargeId}`);
    const refund: FakeRefund = {
      id: `re_${RUN}_${++sequence}`,
      amount,
      created: Math.floor(Date.now() / 1000),
      status: "succeeded",
      metadata: {},
      failure_reason: null,
    };
    charge.refunds.unshift(refund);
    return refund;
  };

  /** Stripe forgets the key, as it may once it is 24 hours old. */
  const forgetKey = (key: string) => keys.delete(key);

  return {
    port,
    webhookPort,
    charges,
    creates,
    behaviours,
    failures,
    listing,
    feeRefunds,
    refundedEvent,
    refundInDashboard,
    forgetKey,
    movedMinor,
  };
}

type FakeStripe = ReturnType<typeof fakeStripe>;

describe("refund of an online payment (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let service: typeof import("./stripe-refund");
  let writes: typeof import("./stripe-refund-writes");
  let webhook: typeof import("@/app/api/webhooks/stripe/connect/charge-refund");
  let outbox: typeof import("@louez/api/platform/effects");
  let counter = 0;
  /** The outbox rows the writes handed to the dispatcher, not run here. */
  const dispatched: string[] = [];
  const env = { billing: process.env.LOUEZ_BILLING, url: process.env.BILLING_SERVICE_URL };

  before(async () => {
    database = await createTestDatabase("stripe_refund");
    // DATABASE_URL now points at the test database.
    louezDb = await import("@louez/db");
    service = await import("./stripe-refund");
    writes = await import("./stripe-refund-writes");
    webhook = await import("@/app/api/webhooks/stripe/connect/charge-refund");
    outbox = await import("@louez/api/platform/effects");
    await louezDb.db.insert(louezDb.stores).values([
      { id: STORE, userId: "owner", name: "Refunds", slug: "refunds", stripeAccountId: ACCOUNT },
      {
        id: OTHER_STORE,
        userId: "owner_other",
        name: "Other",
        slug: "refunds-other",
        stripeAccountId: OTHER_ACCOUNT,
      },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(() => {
    dispatched.length = 0;
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

  type PaymentOptions = {
    storeId?: string;
    reservationCurrency?: string | null;
    /** Upper case. */
    currency?: string;
    /** The charge's amount, and what it captured. */
    amountMinor?: number;
    capturedMinor?: number;
    type?: "rental" | "deposit_capture" | "deposit_hold" | "deposit_return";
    status?: "completed" | "pending" | "refunded";
    method?: "stripe" | "cash";
    withCharge?: boolean;
    /** The payment row's account; `null` for a row written before the column. */
    accountId?: string | null;
    grossMinor?: number | null;
  };

  /** A reservation with one Stripe payment, and its charge at the fake. */
  async function createPayment(stripe: FakeStripe, options: PaymentOptions = {}) {
    const n = ++counter;
    const reservationId = `res_refund_${n}`;
    const paymentId = `pay_refund_${n}`;
    const chargeId = `ch_${RUN}_${n}`;
    const storeId = options.storeId ?? STORE;
    const currency = options.currency ?? "EUR";
    const amountMinor = options.amountMinor ?? 10_000;
    const capturedMinor = options.capturedMinor ?? amountMinor;
    const accountId =
      options.accountId === undefined
        ? storeId === STORE
          ? ACCOUNT
          : OTHER_ACCOUNT
        : options.accountId;
    await louezDb.db.insert(louezDb.reservations).values({
      id: reservationId,
      storeId,
      customerId: "customer",
      number: reservationId,
      status: "confirmed",
      startDate: new Date("2026-10-01T09:00:00Z"),
      endDate: new Date("2026-10-03T09:00:00Z"),
      subtotalAmount: "100.00",
      depositAmount: "0.00",
      totalAmount: "100.00",
      currency: options.reservationCurrency === undefined ? currency : options.reservationCurrency,
    });
    const withCharge = options.withCharge ?? true;
    await louezDb.db.insert(louezDb.payments).values({
      id: paymentId,
      reservationId,
      amount: (capturedMinor / 100).toFixed(2),
      type: options.type ?? "rental",
      method: options.method ?? "stripe",
      status: options.status ?? "completed",
      stripePaymentIntentId: `pi_${RUN}_${n}`,
      stripeChargeId: withCharge ? chargeId : null,
      stripeAccountId: accountId,
      currency,
      grossMinor: options.grossMinor === undefined ? capturedMinor : options.grossMinor,
      paidAt: new Date("2026-10-01T09:30:00Z"),
    });
    stripe.charges.set(chargeId, {
      id: chargeId,
      accountId: accountId ?? (storeId === STORE ? ACCOUNT : OTHER_ACCOUNT),
      currency: currency.toLowerCase(),
      amount: amountMinor,
      captured: capturedMinor,
      refunds: [],
    });
    return { reservationId, paymentId, chargeId };
  }

  const request = (
    paymentId: string,
    amountMinor: number,
    overrides: Partial<RefundRequestInput> = {},
  ): RefundRequestInput => ({
    storeId: STORE,
    paymentId,
    amountMinor,
    currency: "EUR",
    requestedBy: { userId: "user_owner", credentialId: null },
    ...overrides,
  });

  const deps = (stripe: FakeStripe): StripeRefundDeps => ({
    database: louezDb.db,
    stripe: stripe.port,
    dispatchEffects: (ids) => {
      dispatched.push(...ids);
    },
  });

  /** The credit notes owed for a refund row: the outbox rows that issue them, every one. */
  const creditNoteRowsOf = (refundPaymentId: string) =>
    louezDb.db
      .select({ id: louezDb.apiEffects.id, status: louezDb.apiEffects.status })
      .from(louezDb.apiEffects)
      .where(
        and(
          eq(louezDb.apiEffects.type, "payment.refundCreditNote"),
          sql`JSON_UNQUOTE(JSON_EXTRACT(${louezDb.apiEffects.payload}, '$.refundId')) = ${refundPaymentId}`,
        ),
      );

  /** The outbox's own sender, for this fake Stripe. */
  const senders = (stripe: FakeStripe) =>
    service.createStripeRefundEffectSenders(deps(stripe)) as unknown as ApiEffectSenders;

  /** The request in one call, its inline attempt run through the outbox. */
  const refund = (stripe: FakeStripe, input: RefundRequestInput) =>
    service.refundStripePayment(
      {
        ...deps(stripe),
        attemptNow: async (ids) => {
          await outbox.dispatchEffects(ids, senders(stripe), {
            sendTimeoutMs: service.INLINE_REFUND_SEND_TIMEOUT_MS,
          });
        },
      },
      input,
    );

  /** Records the request, sends nothing. */
  const requestOnly = (stripe: FakeStripe, input: RefundRequestInput) =>
    service.refundStripePayment({ ...deps(stripe), attemptNow: async () => {} }, input);

  const send = (stripe: FakeStripe, operationId: string) =>
    service.sendRefundOperation(deps(stripe), operationId, noClaim);

  async function readOperation(operationId: string) {
    const o = louezDb.paymentRefundOperations;
    const [row] = await louezDb.db
      .select({
        status: o.status,
        stripeRefundId: o.stripeRefundId,
        refundPaymentId: o.refundPaymentId,
        failureCode: o.failureCode,
        claimToken: o.claimToken,
        sent: sql<number>`${o.providerRequestedAt} IS NOT NULL`,
      })
      .from(o)
      .where(eq(o.id, operationId));
    return row;
  }

  const operationsOf = (paymentId: string) =>
    louezDb.db
      .select({ id: louezDb.paymentRefundOperations.id })
      .from(louezDb.paymentRefundOperations)
      .where(eq(louezDb.paymentRefundOperations.paymentId, paymentId));

  const refundRowsOf = (paymentId: string) =>
    louezDb.db
      .select({
        id: louezDb.payments.id,
        type: louezDb.payments.type,
        amount: louezDb.payments.amount,
        refundId: louezDb.payments.stripeRefundId,
        grossMinor: louezDb.payments.grossMinor,
        notes: louezDb.payments.notes,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.refundOfPaymentId, paymentId))
      .orderBy(asc(louezDb.payments.createdAt), asc(louezDb.payments.id));

  async function readPayment(paymentId: string) {
    const [row] = await louezDb.db
      .select({
        amount: louezDb.payments.amount,
        status: louezDb.payments.status,
        grossMinor: louezDb.payments.grossMinor,
      })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.id, paymentId));
    return row;
  }

  const refundEffects = (operationId: string) =>
    louezDb.db
      .select({ id: louezDb.apiEffects.id, status: louezDb.apiEffects.status })
      .from(louezDb.apiEffects)
      .where(
        and(
          eq(louezDb.apiEffects.type, "payment.refund"),
          sql`JSON_UNQUOTE(JSON_EXTRACT(${louezDb.apiEffects.payload}, '$.operationId')) = ${operationId}`,
        ),
      );

  /** Moves the operation's dates back, as if its request was made `hours` ago. */
  const age = (operationId: string, hours: { created: number; sent: number | null }) =>
    louezDb.db.execute(sql`
      UPDATE payment_refund_operations
      SET created_at = NOW() - INTERVAL ${hours.created * 60} MINUTE,
          provider_requested_at = ${
            hours.sent === null ? null : sql`NOW() - INTERVAL ${hours.sent * 60} MINUTE`
          }
      WHERE id = ${operationId}`);

  const keyOf = (operationId: string) => refundIdempotencyKey(operationId);

  /** A refund recorded by hand against the payment, cash given back. */
  const recordManualRefund = (reservationId: string, paymentId: string, amount: string) =>
    louezDb.db.insert(louezDb.payments).values({
      id: `pay_manual_${++counter}`,
      reservationId,
      amount,
      type: "rental",
      method: "cash",
      status: "completed",
      refundOfPaymentId: paymentId,
      currency: "EUR",
    });

  async function expectOk(result: Awaited<ReturnType<typeof refund>>) {
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) throw new Error("refused");
    return result.operation;
  }

  // ---------------------------------------------------------------------------
  // One request, one refund
  // ---------------------------------------------------------------------------

  test("a refund is recorded before Stripe, sent with its operation's key and metadata, and recorded once", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);

    const operation = await expectOk(
      await refund(stripe, request(paymentId, 2_500, { notes: "  Late return  " })),
    );

    assert.equal(operation.status, "succeeded");
    assert.deepEqual(stripe.creates, [{ key: `refund:${operation.id}`, chargeId, amount: 2_500 }]);
    const [made] = stripe.charges.get(chargeId)?.refunds ?? [];
    assert.equal(made?.metadata[REFUND_OPERATION_METADATA], operation.id);
    const rows = await refundRowsOf(paymentId);
    assert.deepEqual(
      rows.map(({ type, amount, refundId, grossMinor, notes }) => ({
        type,
        amount,
        refundId,
        grossMinor,
        notes,
      })),
      [
        {
          type: "rental",
          amount: "25.00",
          refundId: made?.id,
          grossMinor: 2_500,
          notes: "Late return",
        },
      ],
    );
    assert.equal(operation.refundPaymentId, rows[0]?.id);
    assert.equal(operation.stripeRefundId, made?.id);
    assert.deepEqual(await readPayment(paymentId), {
      amount: "75.00",
      status: "completed",
      grossMinor: 10_000,
    });
    const notes = await creditNoteRowsOf(rows[0]?.id ?? "");
    assert.equal(notes.length, 1);
    assert.deepEqual(dispatched, [notes[0]?.id]);
    assert.deepEqual(await refundEffects(operation.id), [
      { id: (await refundEffects(operation.id))[0]?.id, status: "sent" },
    ]);
  });

  test("two refunds of the same amount are two operations and two refunds", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);

    const first = await expectOk(await refund(stripe, request(paymentId, 1_000)));
    const second = await expectOk(await refund(stripe, request(paymentId, 1_000)));

    assert.notEqual(first.id, second.id);
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 2);
    assert.equal((await refundRowsOf(paymentId)).length, 2);
    assert.equal((await readPayment(paymentId))?.amount, "80.00");
  });

  // ---------------------------------------------------------------------------
  // Reaching Stripe at most once
  // ---------------------------------------------------------------------------

  test("Stripe makes the refund and its answer is lost: the lookup by metadata records it, with no second request", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    stripe.behaviours.push("lost_after");

    const operation = await expectOk(await refund(stripe, request(paymentId, 4_000)));

    assert.equal(operation.status, "succeeded");
    assert.equal(stripe.creates.length, 1);
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 1);
    assert.equal((await refundRowsOf(paymentId)).length, 1);
  });

  test("a timeout, then a retry, then the outbox: one key, one refund", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    // The first answer is lost after Stripe made it, and the lookup cannot be read.
    stripe.behaviours.push("lost_after");
    stripe.failures.list = 2;

    const operation = await expectOk(await refund(stripe, request(paymentId, 3_000)));
    assert.equal(operation.status, "requested");
    assert.equal((await readOperation(operation.id))?.claimToken, null);

    // A retry by hand, whose Stripe answer cannot be recorded (the charge's refunds
    // cannot be listed), then the outbox's own retry of its row: same key each time.
    await assert.rejects(send(stripe, operation.id), /could not be listed/);
    assert.equal((await readOperation(operation.id))?.status, "requested");
    const [effect] = await refundEffects(operation.id);
    assert.ok(effect);
    await louezDb.db.execute(
      sql`UPDATE api_effects SET next_attempt_at = NOW() - INTERVAL 1 MINUTE WHERE id = ${effect.id}`,
    );
    await outbox.dispatchEffects([effect.id], senders(stripe));

    assert.deepEqual([...new Set(stripe.creates.map((call) => call.key))], [keyOf(operation.id)]);
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 1);
    assert.equal((await readOperation(operation.id))?.status, "succeeded");
    assert.equal((await refundRowsOf(paymentId)).length, 1);
    assert.equal((await refundEffects(operation.id))[0]?.status, "sent");
  });

  test("a 500 Stripe stores for the key, and a request that never reached Stripe, are sent again with the same key", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    stripe.behaviours.push("timeout_before");

    const operation = await expectOk(await refund(stripe, request(paymentId, 1_500)));
    // Nothing at Stripe, and its key may still make one: kept.
    assert.equal(operation.status, "requested");

    await send(stripe, operation.id);
    assert.equal((await readOperation(operation.id))?.status, "succeeded");
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 1);

    const stored = await createPayment(stripe);
    stripe.behaviours.push("error_500");
    const replayed = await expectOk(await refund(stripe, request(stored.paymentId, 1_500)));
    await assert.rejects(send(stripe, replayed.id), /no answer \(replayed\)/);
    // A replayed 500 closes nothing: it stays requested, and nothing was refunded.
    assert.equal((await readOperation(replayed.id))?.status, "requested");
    assert.equal(stripe.charges.get(stored.chargeId)?.refunds.length, 0);
  });

  test("a sender that died after Stripe answered leaves its claim; once the lease is over the next sender records the same refund", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    const operation = await requestOnly(stripe, request(paymentId, 2_000));
    assert.ok(operation.ok);
    if (!operation.ok) return;
    // Stripe answers; reading the charge to record it fails, as a crash would end it.
    stripe.failures.readCharge = 1;
    await assert.rejects(send(stripe, operation.operation.id), /could not be read/);
    // The process died: its claim stays until its lease ends.
    await louezDb.db.execute(sql`
      UPDATE payment_refund_operations
      SET claim_token = 'dead_sender', claimed_until = NOW() + INTERVAL 1 HOUR
      WHERE id = ${operation.operation.id}`);
    await assert.rejects(send(stripe, operation.operation.id), /another sender/);
    await louezDb.db.execute(sql`
      UPDATE payment_refund_operations SET claimed_until = NOW() - INTERVAL 1 SECOND
      WHERE id = ${operation.operation.id}`);

    await send(stripe, operation.operation.id);

    assert.equal(stripe.creates.length, 2);
    assert.equal(stripe.creates[1]?.key, keyOf(operation.operation.id));
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 1);
    assert.equal((await readOperation(operation.operation.id))?.status, "succeeded");
    assert.equal((await refundRowsOf(paymentId)).length, 1);
  });

  test("past 23 hours the key is never sent again: the refund is looked up by its metadata", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    stripe.behaviours.push("lost_after");
    stripe.failures.list = 1;
    const operation = await expectOk(await refund(stripe, request(paymentId, 5_000)));
    assert.equal(operation.status, "requested");
    // Stripe forgot the key: a request sent now would refund again.
    stripe.forgetKey(keyOf(operation.id));
    await age(operation.id, { created: 23.5, sent: 23.5 });

    await send(stripe, operation.id);

    assert.equal(stripe.creates.length, 1);
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 1);
    assert.equal((await readOperation(operation.id))?.status, "succeeded");
  });

  test("a request Stripe never made is closed only by a complete listing 24 hours after its last request", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    stripe.behaviours.push("timeout_before");
    const operation = await expectOk(await refund(stripe, request(paymentId, 5_000)));
    stripe.forgetKey(keyOf(operation.id));

    // 23 and a half hours: not sent again, and the key may still make it.
    await age(operation.id, { created: 23.5, sent: 23.5 });
    await assert.rejects(send(stripe, operation.id), /too old to send again/);
    assert.equal((await readOperation(operation.id))?.status, "unresolved");

    // 25 hours, a listing that stops short: nothing proven.
    await age(operation.id, { created: 25, sent: 25 });
    stripe.failures.incompleteListing = true;
    await assert.rejects(send(stripe, operation.id));
    assert.equal((await readOperation(operation.id))?.status, "unresolved");

    // 25 hours, a complete listing: it never happened.
    stripe.failures.incompleteListing = false;
    await send(stripe, operation.id);

    assert.deepEqual(await readOperation(operation.id), {
      status: "failed",
      stripeRefundId: null,
      refundPaymentId: null,
      failureCode: "not_found_at_stripe",
      claimToken: null,
      sent: 1,
    });
    assert.equal(stripe.creates.length, 1);
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 0);
    // Its amount no longer holds the payment back.
    await expectOk(await refund(stripe, request(paymentId, 10_000)));
  });

  test("an operation never sent is sent whatever its age: Stripe never saw its key", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    const operation = await requestOnly(stripe, request(paymentId, 1_000));
    assert.ok(operation.ok);
    if (!operation.ok) return;
    await age(operation.operation.id, { created: 30, sent: null });

    await send(stripe, operation.operation.id);

    assert.equal(stripe.creates.length, 1);
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 1);
    assert.equal((await readOperation(operation.operation.id))?.status, "succeeded");
  });

  test("Stripe refuses: the operation fails with Stripe's code; refused when sent again, it fails only once the lookup shows nothing", async () => {
    const stripe = fakeStripe();
    const { paymentId } = await createPayment(stripe);
    stripe.behaviours.push({ refuse: "charge_disputed" });

    const failed = await expectOk(await refund(stripe, request(paymentId, 1_000)));
    assert.equal(failed.status, "failed");
    assert.equal(failed.failureCode, "charge_disputed");

    // A first request whose answer was lost after Stripe made the refund; the second
    // request is refused (its key replays nothing, Stripe forgot it): the lookup finds it.
    const other = await createPayment(stripe);
    stripe.behaviours.push("lost_after");
    stripe.failures.list = 1;
    const lost = await expectOk(await refund(stripe, request(other.paymentId, 1_000)));
    stripe.forgetKey(keyOf(lost.id));
    stripe.behaviours.push({ refuse: "amount_too_large" });
    await send(stripe, lost.id);
    assert.equal((await readOperation(lost.id))?.status, "succeeded");
    assert.equal(stripe.charges.get(other.chargeId)?.refunds.length, 1);

    // Sent again and refused, with nothing at Stripe: failed.
    const third = await createPayment(stripe);
    stripe.behaviours.push("timeout_before");
    const unseen = await expectOk(await refund(stripe, request(third.paymentId, 1_000)));
    stripe.behaviours.push({ refuse: "balance_insufficient" });
    await send(stripe, unseen.id);
    assert.equal((await readOperation(unseen.id))?.failureCode, "balance_insufficient");
  });

  test("two requests for the whole payment at once: the second is refused by the open operation", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId } = await createPayment(stripe);

    const results = await raceOnLockedRow(database, { table: "reservations", id: reservationId }, [
      () => requestOnly(stripe, request(paymentId, 10_000)),
      () => requestOnly(stripe, request(paymentId, 10_000)),
    ]);

    const accepted = results.filter((result) => result.ok);
    const refusals = results.flatMap((result) => (result.ok ? [] : [result]));
    assert.equal(accepted.length, 1);
    assert.deepEqual(refusals, [
      {
        ok: false,
        code: "REFUND_EXCEEDS_REFUNDABLE",
        paidMinor: 10_000,
        refundedMinor: 0,
        inFlightMinor: 10_000,
        refundableMinor: 0,
        currency: "EUR",
      },
    ]);
    assert.equal((await operationsOf(paymentId)).length, 1);
    assert.equal(stripe.creates.length, 0);
  });

  // ---------------------------------------------------------------------------
  // Recording once, whoever hears it
  // ---------------------------------------------------------------------------

  /** One refund row, one netting, one credit note, one fee reversal, the operation succeeded. */
  async function assertRecordedOnce(
    stripe: FakeStripe,
    {
      paymentId,
      chargeId,
      operationId,
    }: { paymentId: string; chargeId: string; operationId: string },
    netAmount: string,
  ) {
    const rows = await refundRowsOf(paymentId);
    assert.equal(rows.length, 1);
    assert.equal((await readPayment(paymentId))?.amount, netAmount);
    // One credit note owed, counted without merging duplicates.
    assert.equal((await creditNoteRowsOf(rows[0]?.id ?? "")).length, 1);
    assert.equal(
      stripe.feeRefunds.filter((refund) => refund.feeId === `fee_${chargeId}`).length,
      1,
    );
    const operation = await readOperation(operationId);
    assert.equal(operation?.status, "succeeded");
    assert.equal(operation?.refundPaymentId, rows[0]?.id);
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 1);
  }

  test("the sender's success, then charge.refunded delivered twice: recorded once", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);

    const operation = await expectOk(await refund(stripe, request(paymentId, 4_000)));
    for (let delivery = 0; delivery < 2; delivery++) {
      await webhook.handleChargeRefunded(
        stripe.refundedEvent(chargeId),
        ACCOUNT,
        stripe.webhookPort,
      );
    }
    await send(stripe, operation.id);

    await assertRecordedOnce(stripe, { paymentId, chargeId, operationId: operation.id }, "60.00");
  });

  test("charge.refunded delivered twice before the sender hears Stripe: recorded once, and the sender sends nothing more", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    stripe.behaviours.push("lost_after");
    stripe.failures.list = 1;

    const operation = await expectOk(await refund(stripe, request(paymentId, 4_000)));
    assert.equal(operation.status, "requested");
    for (let delivery = 0; delivery < 2; delivery++) {
      await webhook.handleChargeRefunded(
        stripe.refundedEvent(chargeId),
        ACCOUNT,
        stripe.webhookPort,
      );
    }
    assert.equal((await readOperation(operation.id))?.status, "succeeded");

    assert.deepEqual(await send(stripe, operation.id), {
      skipped: "The refund operation is settled.",
    });
    await send(stripe, operation.id);

    assert.equal(stripe.creates.length, 1);
    await assertRecordedOnce(stripe, { paymentId, chargeId, operationId: operation.id }, "60.00");
  });

  test("the sender and two deliveries of charge.refunded at once: recorded once", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId, chargeId } = await createPayment(stripe);
    stripe.behaviours.push("lost_after");
    stripe.failures.list = 1;
    const operation = await expectOk(await refund(stripe, request(paymentId, 4_000)));
    assert.equal(operation.status, "requested");

    await raceOnLockedRow<unknown>(database, { table: "reservations", id: reservationId }, [
      () => send(stripe, operation.id),
      () =>
        webhook.handleChargeRefunded(stripe.refundedEvent(chargeId), ACCOUNT, stripe.webhookPort),
      () =>
        webhook.handleChargeRefunded(stripe.refundedEvent(chargeId), ACCOUNT, stripe.webhookPort),
    ]);

    await assertRecordedOnce(stripe, { paymentId, chargeId, operationId: operation.id }, "60.00");
  });

  test("a listing read before a later refund and written after it never raises the payment again", async () => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://localhost:3100";
    const stripe = fakeStripe();
    const { reservationId, paymentId, chargeId } = await createPayment(stripe);
    const first = await expectOk(await refund(stripe, request(paymentId, 2_000)));
    const firstRefund = stripe.charges.get(chargeId)?.refunds.at(-1);
    const stale: ProviderRefund[] = firstRefund
      ? [providerRefundFromStripe({ ...firstRefund, currency: "eur" })]
      : [];
    await expectOk(await refund(stripe, request(paymentId, 3_000)));
    assert.equal((await readPayment(paymentId))?.amount, "50.00");

    // The first refund's listing, written last: both refunds still come off.
    await writes.recordChargeRefunds(louezDb.db, {
      paymentId,
      reservationId,
      chargeId,
      currency: "EUR",
      amountCapturedMinor: 10_000,
      refunds: stale,
      source: "test",
    });

    assert.deepEqual(await readPayment(paymentId), {
      amount: "50.00",
      status: "completed",
      grossMinor: 10_000,
    });
    assert.equal((await readOperation(first.id))?.status, "succeeded");
    const [mark] = await louezDb.db
      .select({ version: louezDb.billingSyncQueue.version })
      .from(louezDb.billingSyncQueue)
      .where(eq(louezDb.billingSyncQueue.aggregateId, reservationId));
    assert.ok(mark && mark.version >= 3, "each write marks the reservation");
  });

  test("a refund made in Stripe's dashboard beside an operation's is recorded as before, and settles no operation", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    const operation = await expectOk(await refund(stripe, request(paymentId, 1_000)));
    const byHand = stripe.refundInDashboard(chargeId, 2_000);

    await webhook.handleChargeRefunded(stripe.refundedEvent(chargeId), ACCOUNT, stripe.webhookPort);

    const rows = await refundRowsOf(paymentId);
    assert.deepEqual(
      rows.map((row) => row.refundId).sort(),
      [byHand.id, (await readOperation(operation.id))?.stripeRefundId].sort(),
    );
    assert.equal((await readPayment(paymentId))?.amount, "70.00");
    assert.equal(
      (await readOperation(operation.id))?.refundPaymentId,
      rows.find((row) => row.refundId !== byHand.id)?.id,
    );
  });

  /** A credit note issued for a refund row, as invoicing links one. */
  async function linkCreditNote(reservationId: string, refundPaymentId: string, number: string) {
    const invoiceId = `inv_${++counter}`;
    await louezDb.db.insert(louezDb.invoices).values({
      id: invoiceId,
      storeId: STORE,
      reservationId,
      customerId: "customer",
      type: "credit_note",
      kind: "credit_note",
      number,
      issueDate: "2026-10-02",
      currency: "EUR",
      sellerSnapshot: {} as never,
      buyerSnapshot: {} as never,
      lines: [],
      vatBreakdown: [],
      totalExclTax: "-50.00",
      totalTax: "-10.00",
      totalInclTax: "-60.00",
      en16931Snapshot: {} as never,
      documentId: `doc_${counter}`,
      processingRule: "b2c",
    });
    await louezDb.db.insert(louezDb.invoicePayments).values({
      id: `ip_${counter}`,
      invoiceId,
      paymentId: refundPaymentId,
      amount: "-60.00",
    } as never);
  }

  test("a refund that fails after it was recorded is undone in the books, once, whatever arrives after", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId, chargeId } = await createPayment(stripe);
    const operation = await expectOk(await refund(stripe, request(paymentId, 6_000)));
    await webhook.handleChargeRefunded(stripe.refundedEvent(chargeId), ACCOUNT, stripe.webhookPort);
    const [row] = await refundRowsOf(paymentId);
    assert.ok(row);
    assert.equal((await readPayment(paymentId))?.amount, "40.00");
    await linkCreditNote(reservationId, row.id, "AV-2026-0001");

    const made = stripe.charges.get(chargeId)?.refunds[0];
    assert.ok(made);
    made.status = "failed";
    made.failure_reason = "expired_or_canceled_card";
    const event = { ...made, currency: "eur", charge: chargeId };
    // Delivered twice, and charge.refunded after it.
    for (let delivery = 0; delivery < 2; delivery++) {
      await webhook.handleRefundUpdated(event, ACCOUNT, stripe.webhookPort);
    }
    await webhook.handleChargeRefunded(stripe.refundedEvent(chargeId), ACCOUNT, stripe.webhookPort);

    assert.deepEqual(await readPayment(paymentId), {
      amount: "100.00",
      status: "completed",
      grossMinor: 10_000,
    });
    const [after] = await louezDb.db
      .select({ status: louezDb.payments.status })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.id, row.id));
    assert.equal(after?.status, "failed");
    const settled = await readOperation(operation.id);
    assert.equal(settled?.status, "failed");
    assert.equal(settled?.failureCode, "expired_or_canceled_card");

    // Named once each for the inbox (stripe-refund-inbox.db.test.ts): the refund
    // undone, and the 1.80 of the 3.00 fee given back for the 60.00, which Stripe
    // cannot take back.
    const undoneLines = await louezDb.db
      .select({ metadata: louezDb.reservationActivity.metadata })
      .from(louezDb.reservationActivity)
      .where(
        and(
          eq(louezDb.reservationActivity.reservationId, reservationId),
          sql`JSON_UNQUOTE(JSON_EXTRACT(${louezDb.reservationActivity.metadata}, '$.kind')) IN ('refund_undone', 'refund_fee_over_returned')`,
        ),
      );
    assert.deepEqual(undoneLines.map((line) => (line.metadata as { kind: string }).kind).sort(), [
      "refund_fee_over_returned",
      "refund_undone",
    ]);
    assert.equal(
      undoneLines.find(
        (line) => (line.metadata as { kind: string }).kind === "refund_fee_over_returned",
      )?.metadata?.overReturnedMinor,
      180,
    );

    // The whole payment can be refunded again.
    const over = await refund(stripe, request(paymentId, 10_001));
    assert.equal(
      !over.ok && over.code === "REFUND_EXCEEDS_REFUNDABLE" && over.refundableMinor,
      10_000,
    );

    // The billing snapshot exports no refund for it.
    const { buildReservationSnapshot } =
      await import("@/lib/billing-sync/snapshots/reservation-snapshot");
    const snapshot = await buildReservationSnapshot(louezDb.db, {
      aggregateType: "reservation",
      aggregateId: reservationId,
      storeId: STORE,
    } as never);
    assert.ok(!JSON.stringify(snapshot).includes(made.id));
  });

  test("a refund made in Stripe's dashboard that fails is undone the same way; one of another account changes nothing", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    const byHand = stripe.refundInDashboard(chargeId, 2_500);
    await webhook.handleChargeRefunded(stripe.refundedEvent(chargeId), ACCOUNT, stripe.webhookPort);
    assert.equal((await readPayment(paymentId))?.amount, "75.00");
    byHand.status = "canceled";

    assert.deepEqual(
      await webhook.handleRefundUpdated(
        { ...byHand, currency: "eur", charge: chargeId },
        OTHER_ACCOUNT,
        stripe.webhookPort,
      ),
      { status: "payment_not_found" },
    );
    assert.equal((await readPayment(paymentId))?.amount, "75.00");
    assert.deepEqual(
      await webhook.handleRefundUpdated(
        { ...byHand, currency: "eur", charge: chargeId },
        ACCOUNT,
        stripe.webhookPort,
      ),
      { status: "recorded", paymentId, undone: 1 },
    );
    assert.equal((await readPayment(paymentId))?.amount, "100.00");
  });

  // ---------------------------------------------------------------------------
  // Absence is proven by Stripe's account of the charge only
  // ---------------------------------------------------------------------------

  test("past the key's life, a listing that does not add up to the charge keeps the operation open and its amount held", async () => {
    const stripe = fakeStripe();
    const { paymentId } = await createPayment(stripe);
    stripe.behaviours.push("timeout_before");
    const operation = await expectOk(await refund(stripe, request(paymentId, 10_000)));
    await age(operation.id, { created: 25, sent: 25 });
    // The charge says 100.00 was refunded; its listing shows none.
    stripe.failures.hiddenRefundedMinor = 10_000;

    await assert.rejects(send(stripe, operation.id), /do not add up/);

    assert.equal((await readOperation(operation.id))?.status, "unresolved");
    const again = await refund(stripe, request(paymentId, 10_000));
    assert.equal(
      !again.ok && again.code === "REFUND_EXCEEDS_REFUNDABLE" && again.inFlightMinor,
      10_000,
    );
  });

  test("an unresolved operation whose refund surfaces late is recorded once", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    stripe.behaviours.push("lost_after");
    stripe.failures.list = 1;
    const operation = await expectOk(await refund(stripe, request(paymentId, 3_000)));
    await age(operation.id, { created: 23.5, sent: 23.5 });
    stripe.failures.incompleteListing = true;
    await assert.rejects(send(stripe, operation.id));
    assert.equal((await readOperation(operation.id))?.status, "unresolved");

    stripe.failures.incompleteListing = false;
    await webhook.handleChargeRefunded(stripe.refundedEvent(chargeId), ACCOUNT, stripe.webhookPort);
    await send(stripe, operation.id);

    assert.equal((await readOperation(operation.id))?.status, "succeeded");
    assert.equal((await refundRowsOf(paymentId)).length, 1);
    assert.equal(stripe.creates.length, 1);
  });

  test("a refund on the listing's second page is found", async () => {
    const stripe = fakeStripe();
    stripe.listing.pageSize = 1;
    const { paymentId, chargeId } = await createPayment(stripe);
    stripe.behaviours.push("lost_after");
    stripe.failures.list = 1;
    const operation = await expectOk(await refund(stripe, request(paymentId, 3_000)));
    // A newer refund comes first in the listing.
    stripe.refundInDashboard(chargeId, 1_000);
    await age(operation.id, { created: 23.5, sent: 23.5 });

    await send(stripe, operation.id);

    assert.equal((await readOperation(operation.id))?.status, "succeeded");
    assert.equal((await readPayment(paymentId))?.amount, "60.00");
  });

  // ---------------------------------------------------------------------------
  // The manual writer and the online payment
  // ---------------------------------------------------------------------------

  test("a refund given by hand is refused on a payment taken through Stripe, also while an operation holds part of it", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId } = await createPayment(stripe);
    await requestOnly(stripe, request(paymentId, 8_000));
    const refunds = await import("@louez/api/services/payment-records");
    const unused = async () => {
      throw new Error("the writer is never reached");
    };
    await assert.rejects(
      refunds.recordPaymentRefund(
        {
          storeId: STORE,
          storeSettings: null,
          port: { insert: unused, creditNote: unused } as never,
          confirm: async () => null,
          dispatchEffects: () => {},
        },
        { reservationId, paymentId, amount: "50.00", method: "cash" },
        { source: "test" },
      ),
      (error: { data?: { code?: string } }) => error.data?.code === "REFUND_STRIPE_PAYMENT",
    );
    assert.deepEqual(await refundRowsOf(paymentId), []);
  });

  // ---------------------------------------------------------------------------
  // The credit note is owed durably
  // ---------------------------------------------------------------------------

  test("a credit note that fails once is issued by the outbox's retry", async () => {
    const stripe = fakeStripe();
    const { paymentId } = await createPayment(stripe);
    await expectOk(await refund(stripe, request(paymentId, 2_000)));
    const [row] = await refundRowsOf(paymentId);
    assert.ok(row);
    const [note] = await creditNoteRowsOf(row.id);
    assert.ok(note);

    const issued: string[] = [];
    let failures = 1;
    const { createRefundCreditNoteEffectSenders } =
      await import("@/lib/invoicing/refund-credit-note-effects");
    const senders = createRefundCreditNoteEffectSenders({
      issue: async (request) => {
        if (failures-- > 0) return { status: "failed", reason: "pdf_failed" } as never;
        issued.push(request.refundId);
        return { status: "issued" } as never;
      },
    }) as unknown as ApiEffectSenders;
    await outbox.dispatchEffects([note.id], senders);
    assert.equal((await creditNoteRowsOf(row.id))[0]?.status, "failed");
    await louezDb.db.execute(
      sql`UPDATE api_effects SET next_attempt_at = NOW() - INTERVAL 1 MINUTE WHERE id = ${note.id}`,
    );
    await outbox.dispatchEffects([note.id], senders);

    assert.deepEqual(issued, [row.id]);
    assert.equal((await creditNoteRowsOf(row.id))[0]?.status, "sent");
  });

  // ---------------------------------------------------------------------------
  // What is recorded never goes backwards
  // ---------------------------------------------------------------------------

  const statusOfRow = async (refundId: string) => {
    const rows = await louezDb.db
      .select({ status: louezDb.payments.status })
      .from(louezDb.payments)
      .where(eq(louezDb.payments.stripeRefundId, refundId));
    return rows.map((row) => row.status);
  };

  const failedListedLines = (reservationId: string) =>
    louezDb.db
      .select({ id: louezDb.reservationActivity.id })
      .from(louezDb.reservationActivity)
      .where(
        and(
          eq(louezDb.reservationActivity.reservationId, reservationId),
          sql`JSON_UNQUOTE(JSON_EXTRACT(${louezDb.reservationActivity.metadata}, '$.kind')) = 'refund_failed_listed'`,
        ),
      );

  test("a listing read before a refund failed, applied after its failure, changes nothing", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId, chargeId } = await createPayment(stripe);
    const operation = await expectOk(await refund(stripe, request(paymentId, 6_000)));
    const made = stripe.charges.get(chargeId)?.refunds[0];
    assert.ok(made);
    // The listing as it was while the refund moved money.
    const stale = stripe.charges
      .get(chargeId)
      ?.refunds.map((refund) => providerRefundFromStripe({ ...refund, currency: "eur" }));
    assert.ok(stale);
    made.status = "failed";
    await webhook.handleRefundUpdated(
      { ...made, currency: "eur", charge: chargeId },
      ACCOUNT,
      stripe.webhookPort,
    );
    assert.equal((await readPayment(paymentId))?.amount, "100.00");

    for (let delivery = 0; delivery < 2; delivery++) {
      await writes.recordChargeRefunds(louezDb.db, {
        paymentId,
        reservationId,
        chargeId,
        currency: "EUR",
        amountCapturedMinor: 10_000,
        refunds: stale,
        source: "test",
      });
    }

    assert.deepEqual(await readPayment(paymentId), {
      amount: "100.00",
      status: "completed",
      grossMinor: 10_000,
    });
    assert.deepEqual(await statusOfRow(made.id), ["failed"]);
    assert.equal((await readOperation(operation.id))?.status, "failed");
    // Named once for a person: Stripe listed as moving money a refund Louez holds failed.
    assert.equal((await failedListedLines(reservationId)).length, 1);
  });

  test("a refund that fails before Louez wrote its row is kept failed, and a stale listing never records it", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId, chargeId } = await createPayment(stripe);
    // Stripe made the refund; nobody recorded it.
    stripe.behaviours.push("lost_after");
    stripe.failures.list = 1;
    const operation = await expectOk(await refund(stripe, request(paymentId, 6_000)));
    assert.equal(operation.status, "requested");
    const made = stripe.charges.get(chargeId)?.refunds[0];
    assert.ok(made);
    const stale = [providerRefundFromStripe({ ...made, currency: "eur" })];
    made.status = "failed";

    for (let delivery = 0; delivery < 2; delivery++) {
      await webhook.handleRefundUpdated(
        { ...made, currency: "eur", charge: chargeId },
        ACCOUNT,
        stripe.webhookPort,
      );
    }
    for (let delivery = 0; delivery < 2; delivery++) {
      await writes.recordChargeRefunds(louezDb.db, {
        paymentId,
        reservationId,
        chargeId,
        currency: "EUR",
        amountCapturedMinor: 10_000,
        refunds: stale,
        source: "test",
      });
    }
    await send(stripe, operation.id);

    assert.deepEqual(await statusOfRow(made.id), ["failed"]);
    const [row] = await refundRowsOf(paymentId);
    assert.ok(row);
    assert.deepEqual(await creditNoteRowsOf(row.id), []);
    assert.equal((await readOperation(operation.id))?.status, "failed");
    assert.deepEqual(await readPayment(paymentId), {
      amount: "100.00",
      status: "completed",
      grossMinor: 10_000,
    });
  });

  // ---------------------------------------------------------------------------
  // A failed refund is final, for each shape a refund was ever recorded in
  // ---------------------------------------------------------------------------

  /** The rows that are a refund (never the payment the oldest webhooks stamped) for one refund id. */
  const refundRowsFor = (refundId: string) =>
    louezDb.db
      .select({ status: louezDb.payments.status, refundOf: louezDb.payments.refundOfPaymentId })
      .from(louezDb.payments)
      .where(
        and(
          eq(louezDb.payments.stripeRefundId, refundId),
          sql`${louezDb.payments.stripePaymentIntentId} IS NULL`,
          sql`${louezDb.payments.stripeCheckoutSessionId} IS NULL`,
        ),
      );

  for (const shape of ["linked", "unlinked", "stamped"] as const) {
    for (const order of ["the failure first", "the older listing first"] as const) {
      test(`a refund recorded ${shape} that fails ends at what was paid, ${order}, each heard twice`, async () => {
        const stripe = fakeStripe();
        const { reservationId, paymentId, chargeId } = await createPayment(stripe);
        const made = stripe.refundInDashboard(chargeId, 6_000);
        // How the refund was recorded, as Louez's webhooks did over time.
        if (shape === "stamped") {
          await louezDb.db
            .update(louezDb.payments)
            .set({ stripeRefundId: made.id })
            .where(eq(louezDb.payments.id, paymentId));
        } else {
          await louezDb.db.insert(louezDb.payments).values({
            id: `pay_legacy_${++counter}`,
            reservationId,
            amount: "60.00",
            type: "rental",
            method: "stripe",
            status: "completed",
            stripeRefundId: made.id,
            refundOfPaymentId: shape === "linked" ? paymentId : null,
            stripeChargeId: shape === "unlinked" ? chargeId : null,
            currency: "EUR",
            grossMinor: 6_000,
          });
        }
        await louezDb.db
          .update(louezDb.payments)
          .set({ amount: "40.00" })
          .where(eq(louezDb.payments.id, paymentId));
        const older = [providerRefundFromStripe({ ...made, currency: "eur" })];
        made.status = "failed";

        const failure = () =>
          webhook.handleRefundUpdated(
            { ...made, currency: "eur", charge: chargeId },
            ACCOUNT,
            stripe.webhookPort,
          );
        const olderListing = () =>
          writes.recordChargeRefunds(louezDb.db, {
            paymentId,
            reservationId,
            chargeId,
            currency: "EUR",
            amountCapturedMinor: 10_000,
            refunds: older,
            source: "test",
          });
        const steps =
          order === "the failure first"
            ? [failure, failure, olderListing, olderListing]
            : [olderListing, olderListing, failure, failure];
        for (const step of steps) await step();

        assert.deepEqual(await readPayment(paymentId), {
          amount: "100.00",
          status: "completed",
          grossMinor: 10_000,
        });
        const rows = await refundRowsFor(made.id);
        assert.deepEqual(
          rows.map((row) => row.status),
          ["failed"],
        );
        // A legacy row keeps its link, or the lack of it; a new one is linked.
        assert.equal(rows[0]?.refundOf, shape === "unlinked" ? null : paymentId);
        // No credit note is owed for a refund Louez only ever recorded the old way.
        const notes = await louezDb.db
          .select({ id: louezDb.apiEffects.id })
          .from(louezDb.apiEffects)
          .where(
            and(
              eq(louezDb.apiEffects.type, "payment.refundCreditNote"),
              sql`JSON_UNQUOTE(JSON_EXTRACT(${louezDb.apiEffects.payload}, '$.paymentId')) = ${paymentId}`,
            ),
          );
        assert.deepEqual(notes, []);
      });
    }
  }

  for (const shape of ["linked", "unlinked", "stamped"] as const) {
    test(`the fee given back on a refund recorded ${shape} that fails is recorded once`, async () => {
      const stripe = fakeStripe();
      const { reservationId, paymentId, chargeId } = await createPayment(stripe);
      const made = stripe.refundInDashboard(chargeId, 6_000);
      if (shape === "stamped") {
        await louezDb.db
          .update(louezDb.payments)
          .set({ stripeRefundId: made.id })
          .where(eq(louezDb.payments.id, paymentId));
      } else {
        await louezDb.db.insert(louezDb.payments).values({
          id: `pay_legacy_fee_${++counter}`,
          reservationId,
          amount: "60.00",
          type: "rental",
          method: "stripe",
          status: "completed",
          stripeRefundId: made.id,
          refundOfPaymentId: shape === "linked" ? paymentId : null,
          stripeChargeId: shape === "unlinked" ? chargeId : null,
          currency: "EUR",
          grossMinor: 6_000,
        });
      }
      // 1.80 of the 3.00 fee given back for the 60.00, then the refund fails.
      await webhook.handleChargeRefunded(
        stripe.refundedEvent(chargeId),
        ACCOUNT,
        stripe.webhookPort,
      );
      made.status = "failed";
      for (let delivery = 0; delivery < 2; delivery++) {
        await webhook.handleRefundUpdated(
          { ...made, currency: "eur", charge: chargeId },
          ACCOUNT,
          stripe.webhookPort,
        );
      }

      const [failedRow] = await louezDb.db
        .select({ id: louezDb.payments.id })
        .from(louezDb.payments)
        .where(
          and(
            eq(louezDb.payments.stripeRefundId, made.id),
            eq(louezDb.payments.status, "failed"),
            sql`${louezDb.payments.stripePaymentIntentId} IS NULL`,
          ),
        );
      assert.ok(failedRow);
      const lines = await louezDb.db
        .select({ metadata: louezDb.reservationActivity.metadata })
        .from(louezDb.reservationActivity)
        .where(
          and(
            eq(louezDb.reservationActivity.reservationId, reservationId),
            sql`JSON_UNQUOTE(JSON_EXTRACT(${louezDb.reservationActivity.metadata}, '$.kind')) = 'refund_fee_over_returned'`,
          ),
        );
      assert.deepEqual(
        lines.map((line) => {
          const metadata = line.metadata as { paymentId: string; overReturnedMinor: number };
          return [metadata.paymentId, metadata.overReturnedMinor];
        }),
        [[failedRow.id, 180]],
      );
      assert.equal((await readPayment(paymentId))?.amount, "100.00");
    });
  }

  test("a refund made through one row of a charge that fails is undone there, whichever row the event names", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId: first, chargeId } = await createPayment(stripe);
    const second = await secondRowOf(reservationId, chargeId);
    const operation = await expectOk(await refund(stripe, request(second, 6_000)));
    assert.equal(operation.status, "succeeded");
    assert.equal((await readPayment(second))?.amount, "40.00");
    const made = stripe.charges.get(chargeId)?.refunds[0];
    assert.ok(made);
    const listing = () => [providerRefundFromStripe({ ...made, currency: "eur" })];
    const heardOn = (paymentId: string) =>
      writes.recordChargeRefunds(louezDb.db, {
        paymentId,
        reservationId,
        chargeId,
        currency: "EUR",
        amountCapturedMinor: 10_000,
        refunds: listing(),
        source: "test",
      });

    // Its success heard on the other row: recorded once.
    await heardOn(first);
    assert.equal((await refundRowsFor(made.id)).length, 1);
    assert.equal((await readOperation(operation.id))?.status, "succeeded");

    // Its failure heard on the other row: undone on the row it came off.
    made.status = "failed";
    await heardOn(first);
    await heardOn(first);

    assert.equal((await readOperation(operation.id))?.status, "failed");
    assert.equal((await readPayment(second))?.amount, "100.00");
    assert.equal((await readPayment(first))?.amount, "100.00");
    assert.deepEqual(
      (await refundRowsFor(made.id)).map((row) => [row.status, row.refundOf]),
      [["failed", second]],
    );
  });

  // ---------------------------------------------------------------------------
  // The charge's ceiling, whichever of its rows is asked
  // ---------------------------------------------------------------------------

  /** A second payment row of the same reservation, on the same charge. */
  async function secondRowOf(reservationId: string, chargeId: string) {
    const id = `pay_second_${++counter}`;
    await louezDb.db.insert(louezDb.payments).values({
      id,
      reservationId,
      amount: "100.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      stripePaymentIntentId: `pi_second_${counter}`,
      stripeChargeId: chargeId,
      stripeAccountId: ACCOUNT,
      currency: "EUR",
      grossMinor: 10_000,
    });
    return id;
  }

  test("a refund through one row of a charge counts what was given back against another", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId, chargeId } = await createPayment(stripe);
    const second = await secondRowOf(reservationId, chargeId);
    await recordManualRefund(reservationId, paymentId, "30.00");

    const over = await refund(stripe, request(second, 7_001));
    assert.equal(
      !over.ok && over.code === "REFUND_EXCEEDS_REFUNDABLE" && over.refundableMinor,
      7_000,
    );
    await expectOk(await refund(stripe, request(second, 7_000)));
    assert.equal(stripe.movedMinor(stripe.charges.get(chargeId)!), 7_000);
  });

  test("two requests at once through two rows of one charge: the second is refused by the first's", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId, chargeId } = await createPayment(stripe);
    const second = await secondRowOf(reservationId, chargeId);
    await recordManualRefund(reservationId, paymentId, "30.00");

    const results = await raceOnLockedRow(database, { table: "reservations", id: reservationId }, [
      () => requestOnly(stripe, request(paymentId, 7_000)),
      () => requestOnly(stripe, request(second, 7_000)),
    ]);

    assert.deepEqual(results.map((result) => (result.ok ? "ok" : result.code)).sort(), [
      "REFUND_EXCEEDS_REFUNDABLE",
      "ok",
    ]);
  });

  test("a charge recorded on payment rows of two reservations is refused", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    const other = await createPayment(stripe);
    await secondRowOf(other.reservationId, chargeId);

    const shared = await refund(stripe, request(paymentId, 1_000));
    assert.equal(!shared.ok && shared.code, "PAYMENT_CHARGE_SHARED");
    assert.match(!shared.ok && "message" in shared ? shared.message : "", /Stripe dashboard/);
  });

  // ---------------------------------------------------------------------------
  // The ceiling
  // ---------------------------------------------------------------------------

  test("a refund given by hand and a Stripe refund never exceed what was paid", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId, chargeId } = await createPayment(stripe);
    await recordManualRefund(reservationId, paymentId, "30.00");
    await expectOk(await refund(stripe, request(paymentId, 5_000)));

    const over = await refund(stripe, request(paymentId, 2_001));
    assert.deepEqual(over, {
      ok: false,
      code: "REFUND_EXCEEDS_REFUNDABLE",
      paidMinor: 10_000,
      refundedMinor: 8_000,
      inFlightMinor: 0,
      refundableMinor: 2_000,
      currency: "EUR",
    });
    await expectOk(await refund(stripe, request(paymentId, 2_000)));

    // A refund made in Stripe's dashboard that Louez has not heard of yet counts too.
    const next = await createPayment(stripe);
    await recordManualRefund(next.reservationId, next.paymentId, "30.00");
    stripe.refundInDashboard(next.chargeId, 5_000);
    const refused = await refund(stripe, request(next.paymentId, 2_001));
    assert.equal(!refused.ok && refused.code, "REFUND_EXCEEDS_REFUNDABLE");
    assert.equal(stripe.movedMinor(stripe.charges.get(chargeId)!), 7_000);
  });

  test("the legacy shapes of a Stripe refund row each count once", async () => {
    const stripe = fakeStripe();

    // Shape 1: the oldest webhooks stamped the refund id on the payment, netted, with
    // no gross: Stripe's figure holds the refund.
    const stamped = await createPayment(stripe, { grossMinor: null });
    const legacy = stripe.refundInDashboard(stamped.chargeId, 4_000);
    await louezDb.db
      .update(louezDb.payments)
      .set({ stripeRefundId: legacy.id, amount: "60.00" })
      .where(eq(louezDb.payments.id, stamped.paymentId));
    const shape1 = await refund(stripe, request(stamped.paymentId, 6_001));
    assert.equal(
      !shape1.ok && shape1.code === "REFUND_EXCEEDS_REFUNDABLE" && shape1.refundableMinor,
      6_000,
    );

    // Shape 2: a dashboard refund of its own row, with the charge id and no link.
    const separate = await createPayment(stripe);
    const shape2Refund = stripe.refundInDashboard(separate.chargeId, 3_000);
    await louezDb.db.insert(louezDb.payments).values({
      id: `pay_shape2_${++counter}`,
      reservationId: separate.reservationId,
      amount: "30.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      stripeRefundId: shape2Refund.id,
      stripeChargeId: separate.chargeId,
      currency: "EUR",
    });
    const shape2 = await refund(stripe, request(separate.paymentId, 7_001));
    assert.equal(
      !shape2.ok && shape2.code === "REFUND_EXCEEDS_REFUNDABLE" && shape2.refundableMinor,
      7_000,
    );
    // Counted once, though Louez and Stripe both know it.
    assert.equal(
      !shape2.ok && shape2.code === "REFUND_EXCEEDS_REFUNDABLE" && shape2.refundedMinor,
      3_000,
    );

    // Shape 3: the row the webhook writes today, linked to the payment.
    const linked = await createPayment(stripe);
    stripe.refundInDashboard(linked.chargeId, 2_500);
    await webhook.handleChargeRefunded(
      stripe.refundedEvent(linked.chargeId),
      ACCOUNT,
      stripe.webhookPort,
    );
    const shape3 = await refund(stripe, request(linked.paymentId, 7_501));
    assert.equal(
      !shape3.ok && shape3.code === "REFUND_EXCEEDS_REFUNDABLE" && shape3.refundableMinor,
      7_500,
    );
    await expectOk(await refund(stripe, request(linked.paymentId, 7_500)));
  });

  test("after a partial capture, only what was captured can be refunded", async () => {
    const stripe = fakeStripe();
    const { paymentId } = await createPayment(stripe, {
      amountMinor: 10_000,
      capturedMinor: 6_000,
    });

    const over = await refund(stripe, request(paymentId, 6_001));
    assert.equal(!over.ok && over.code === "REFUND_EXCEEDS_REFUNDABLE" && over.paidMinor, 6_000);
    await expectOk(await refund(stripe, request(paymentId, 6_000)));
    assert.deepEqual(await readPayment(paymentId), {
      amount: "0.00",
      status: "refunded",
      grossMinor: 6_000,
    });
  });

  test("a payment in another currency than the reservation's is refunded in its own", async () => {
    const stripe = fakeStripe();
    const { paymentId } = await createPayment(stripe, {
      currency: "USD",
      reservationCurrency: "EUR",
    });

    assert.deepEqual(await refund(stripe, request(paymentId, 1_000, { currency: "EUR" })), {
      ok: false,
      code: "REFUND_CURRENCY_MISMATCH",
      currency: "USD",
    });
    const operation = await expectOk(
      await refund(stripe, request(paymentId, 1_000, { currency: "usd" })),
    );
    assert.equal(operation.currency, "USD");
  });

  test("a deposit capture is refunded as a deposit return; a hold is refused", async () => {
    const stripe = fakeStripe();
    const capture = await createPayment(stripe, { type: "deposit_capture", amountMinor: 5_000 });
    const operation = await expectOk(await refund(stripe, request(capture.paymentId, 2_000)));
    assert.equal(operation.refundType, "deposit_return");
    assert.deepEqual(
      (await refundRowsOf(capture.paymentId)).map((row) => row.type),
      ["deposit_return"],
    );

    const hold = await createPayment(stripe, { type: "deposit_hold", amountMinor: 5_000 });
    assert.deepEqual(await refund(stripe, request(hold.paymentId, 1_000)), {
      ok: false,
      code: "PAYMENT_NOT_REFUNDABLE",
      reason: "deposit_hold",
    });
  });

  // ---------------------------------------------------------------------------
  // Refusals
  // ---------------------------------------------------------------------------

  test("every refusal has its code, and writes nothing", async () => {
    const stripe = fakeStripe();
    const paid = await createPayment(stripe);
    const effectsBefore = await louezDb.db
      .select({ id: louezDb.apiEffects.id })
      .from(louezDb.apiEffects);

    const refusal = async (input: RefundRequestInput) => {
      const result = await refund(stripe, input);
      assert.equal(result.ok, false, JSON.stringify(result));
      return result.ok ? null : result.code;
    };

    assert.equal(await refusal(request("pay_unknown", 100)), "PAYMENT_NOT_FOUND");
    const elsewhere = await createPayment(stripe, { storeId: OTHER_STORE });
    assert.equal(await refusal(request(elsewhere.paymentId, 100)), "PAYMENT_NOT_FOUND");

    const cash = await createPayment(stripe, { method: "cash" });
    assert.deepEqual(await refund(stripe, request(cash.paymentId, 100)), {
      ok: false,
      code: "PAYMENT_NOT_REFUNDABLE",
      reason: "not_online",
    });
    const manual = `pay_manual_${++counter}`;
    await louezDb.db.insert(louezDb.payments).values({
      id: manual,
      reservationId: paid.reservationId,
      amount: "10.00",
      type: "rental",
      method: "stripe",
      status: "completed",
      refundOfPaymentId: paid.paymentId,
      stripeChargeId: paid.chargeId,
      currency: "EUR",
    });
    assert.deepEqual(await refund(stripe, request(manual, 100)), {
      ok: false,
      code: "PAYMENT_NOT_REFUNDABLE",
      reason: "refund_row",
    });
    await louezDb.db.delete(louezDb.payments).where(eq(louezDb.payments.id, manual));

    const pending = await createPayment(stripe, { status: "pending" });
    assert.equal(await refusal(request(pending.paymentId, 100)), "PAYMENT_NOT_SETTLED");
    const noCharge = await createPayment(stripe, { withCharge: false });
    assert.equal(await refusal(request(noCharge.paymentId, 100)), "PAYMENT_NOT_SETTLED");

    for (const amount of [0, -100, 10.5, Number.NaN]) {
      assert.equal(await refusal(request(paid.paymentId, amount)), "REFUND_AMOUNT_INVALID");
    }
    assert.equal(await refusal(request(paid.paymentId, 10_001)), "REFUND_EXCEEDS_REFUNDABLE");
    assert.equal(
      await refusal(request(paid.paymentId, 100, { currency: "GBP" })),
      "REFUND_CURRENCY_MISMATCH",
    );

    const dinars = await createPayment(stripe, { currency: "KWD" });
    assert.equal(
      await refusal(request(dinars.paymentId, 100, { currency: "KWD" })),
      "REFUND_CURRENCY_NOT_SUPPORTED",
    );

    const disputed = await createPayment(stripe);
    await louezDb.db.insert(louezDb.paymentDisputes).values({
      id: `dp_${RUN}_${++counter}`,
      paymentId: disputed.paymentId,
      reservationId: disputed.reservationId,
      amountMinor: 10_000,
      currency: "EUR",
      status: "open",
      stripeStatus: "needs_response",
    });
    assert.equal(await refusal(request(disputed.paymentId, 100)), "PAYMENT_DISPUTED");

    // No account on the payment's row, nor on its store today.
    const orphan = await createPayment(stripe, { accountId: null });
    await louezDb.db
      .update(louezDb.stores)
      .set({ stripeAccountId: null })
      .where(eq(louezDb.stores.id, STORE));
    try {
      assert.equal(await refusal(request(orphan.paymentId, 100)), "NO_STRIPE_ACCOUNT");
    } finally {
      await louezDb.db
        .update(louezDb.stores)
        .set({ stripeAccountId: ACCOUNT })
        .where(eq(louezDb.stores.id, STORE));
    }

    for (const payment of [paid, cash, pending, noCharge, dinars, disputed, orphan]) {
      assert.deepEqual(await operationsOf(payment.paymentId), []);
    }
    const effectsAfter = await louezDb.db
      .select({ id: louezDb.apiEffects.id })
      .from(louezDb.apiEffects);
    assert.equal(effectsAfter.length, effectsBefore.length);
    assert.equal(stripe.creates.length, 0);
  });

  test("one approval gives one refund at most", async () => {
    const stripe = fakeStripe();
    const { reservationId, paymentId } = await createPayment(stripe);

    await expectOk(
      await refund(stripe, request(paymentId, 1_000, { approvalId: "approval_once" })),
    );
    assert.deepEqual(
      await refund(stripe, request(paymentId, 1_000, { approvalId: "approval_once" })),
      { ok: false, code: "REFUND_APPROVAL_USED" },
    );

    // Two at once: one wins, under the unique index if the read did not see it.
    const results = await raceOnLockedRow(database, { table: "reservations", id: reservationId }, [
      () => requestOnly(stripe, request(paymentId, 1_000, { approvalId: "approval_race" })),
      () => requestOnly(stripe, request(paymentId, 1_000, { approvalId: "approval_race" })),
    ]);
    assert.deepEqual(results.map((result) => (result.ok ? "ok" : result.code)).sort(), [
      "REFUND_APPROVAL_USED",
      "ok",
    ]);
    await assert.rejects(
      louezDb.db.insert(louezDb.paymentRefundOperations).values({
        id: `op_dup_${++counter}`,
        storeId: STORE,
        reservationId,
        paymentId,
        stripeAccountId: ACCOUNT,
        stripeChargeId: "ch_dup",
        amountMinor: 1,
        currency: "EUR",
        refundType: "rental",
        reason: "requested_by_customer",
        approvalId: "approval_once",
      }),
      (error: unknown) => louezDb.isDuplicateKeyError(error),
    );
  });

  test("a payment whose row names no account is refunded on its store's account", async () => {
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe, { accountId: null });

    const operation = await expectOk(await refund(stripe, request(paymentId, 1_000)));

    assert.equal(operation.status, "succeeded");
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 1);
  });

  // ---------------------------------------------------------------------------
  // The scheduled pass
  // ---------------------------------------------------------------------------

  test("the cron gives an operation whose outbox row was abandoned a new one, once, within its bounds", async () => {
    // The pass reads every store's operations: the other tests' are closed first.
    await louezDb.db.execute(
      sql`UPDATE payment_refund_operations SET status = 'failed' WHERE status IN ('requested', 'unresolved')`,
    );
    const stripe = fakeStripe();
    const { paymentId, chargeId } = await createPayment(stripe);
    stripe.behaviours.push("timeout_before");
    const operation = await expectOk(await refund(stripe, request(paymentId, 1_000)));
    const [effect] = await refundEffects(operation.id);
    assert.ok(effect);

    // Its row still runs: nothing added.
    await louezDb.db.execute(sql`UPDATE api_effects SET status = 'failed' WHERE id = ${effect.id}`);
    assert.deepEqual(await service.requeueStaleRefundOperations(louezDb.db), []);

    // Abandoned an hour ago: a new row, once.
    await louezDb.db.execute(sql`
      UPDATE api_effects SET status = 'abandoned', created_at = NOW() - INTERVAL 2 HOUR
      WHERE id = ${effect.id}`);
    // Out of time before the first operation: nothing taken.
    let now = 0;
    assert.deepEqual(
      await service.requeueStaleRefundOperations(louezDb.db, {
        budgetMs: 10,
        clock: () => (now += 100),
      }),
      [],
    );
    // Two passes at once read it stale; under its reservation's lock, one adds a row.
    const { reservationId } = (await service.getRefundOperation(louezDb.db, {
      storeId: STORE,
      operationId: operation.id,
    }))!;
    const passes = await raceOnLockedRow(database, { table: "reservations", id: reservationId }, [
      () => service.requeueStaleRefundOperations(louezDb.db),
      () => service.requeueStaleRefundOperations(louezDb.db),
    ]);
    const ids = passes.flat();
    assert.equal(ids.length, 1);
    assert.deepEqual(await service.requeueStaleRefundOperations(louezDb.db), []);

    await outbox.dispatchEffects(ids, senders(stripe));
    assert.equal((await readOperation(operation.id))?.status, "succeeded");
    assert.equal(stripe.charges.get(chargeId)?.refunds.length, 1);
    // Settled: nothing more to add.
    await louezDb.db.execute(sql`
      UPDATE api_effects SET status = 'abandoned', created_at = NOW() - INTERVAL 2 HOUR
      WHERE type = 'payment.refund'`);
    assert.deepEqual(await service.requeueStaleRefundOperations(louezDb.db), []);
  });

  test("getRefundOperation answers the store's own operations only", async () => {
    const stripe = fakeStripe();
    const { paymentId } = await createPayment(stripe);
    const operation = await expectOk(await refund(stripe, request(paymentId, 1_000)));

    assert.equal(
      (await service.getRefundOperation(louezDb.db, { storeId: STORE, operationId: operation.id }))
        ?.id,
      operation.id,
    );
    assert.equal(
      await service.getRefundOperation(louezDb.db, {
        storeId: OTHER_STORE,
        operationId: operation.id,
      }),
      null,
    );
  });
});
