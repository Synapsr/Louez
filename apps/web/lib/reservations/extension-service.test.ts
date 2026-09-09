import assert from "node:assert/strict";
import { after, test } from "node:test";
import * as nodeModule from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getTableName } from "drizzle-orm";
import * as schema from "@louez/db/schema";
import type Stripe from "stripe";
import type { ExtensionAttempt } from "./extension.types";

const directory = mkdtempSync(join(tmpdir(), "louez-extension-tests-"));
const fixturePath = join(directory, "dependencies.cjs");
writeFileSync(fixturePath, "module.exports = globalThis.__louezExtensionTestDependencies;");
after(() => rmSync(directory, { recursive: true }));
const originalEnd = new Date("2030-06-11T10:00:00Z");
const requestedEnd = new Date("2030-06-12T10:00:00Z");
const plan: ExtensionAttempt["plan"] = {
  subtotalAmount: "40",
  totalAmount: "40",
  subtotalExclTax: null,
  taxAmount: null,
  taxRate: null,
  items: [
    {
      id: "item",
      unitPrice: "40",
      totalPrice: "40",
      taxRate: null,
      taxAmount: null,
      priceExclTax: null,
      totalExclTax: null,
    },
  ],
};
const fresh = () => ({
  id: "reservation",
  storeId: "store",
  customerId: "customer",
  status: "confirmed",
  number: "TEST",
  startDate: new Date("2030-06-10T10:00:00Z"),
  endDate: originalEnd,
  store: {
    id: "store",
    slug: "shop",
    stripeAccountId: "acct_test",
    email: "merchant@example.invalid",
    settings: { currency: "EUR" },
  },
  customer: { email: "customer@example.invalid" },
  activity: [] as Array<{ id: string; metadata: ExtensionAttempt }>,
});
let reservation = fresh();
let paymentRows: Record<string, unknown>[] = [];
let refundCalls = 0;
let sessionCreates = 0;
let emailCalls = 0;
let contractCalls = 0;
let unavailable = false;
let supplement = 20;
let failRefund = false;
let paidSession: Stripe.Checkout.Session;
let serial = Promise.resolve();
class ExtensionError extends Error {}
const fingerprint = () => `${reservation.status}:${reservation.endDate.toISOString()}`;
const tx = {
  update: (table: Parameters<typeof getTableName>[0]) => ({
    set: (value: Record<string, unknown>) => ({
      where: async () => {
        const name = getTableName(table);
        if (name === "reservation_activity")
          reservation.activity[0].metadata = value.metadata as ExtensionAttempt;
        if (name === "reservations") Object.assign(reservation, value);
        if (name === "payments") Object.assign(paymentRows[0], value);
      },
    }),
  }),
  insert: (table: Parameters<typeof getTableName>[0]) => ({
    values: async (value: Record<string, unknown>) => {
      if (getTableName(table) === "reservation_activity")
        reservation.activity.push({
          id: String(value.id),
          metadata: value.metadata as ExtensionAttempt,
        });
      if (getTableName(table) === "payments") paymentRows.push(value);
    },
  }),
};
const dependencies = {
  ...schema,
  env: { NEXT_PUBLIC_APP_URL: "https://example.invalid" },
  db: {
    transaction: async <T>(fn: (transaction: typeof tx) => Promise<T>) => {
      const before = serial;
      let release = () => {};
      serial = new Promise<void>((resolve) => {
        release = resolve;
      });
      await before;
      const snapshot = structuredClone(reservation);
      const oldPayments = structuredClone(paymentRows);
      try {
        return await fn(tx);
      } catch (error) {
        reservation = snapshot;
        paymentRows = oldPayments;
        throw error;
      } finally {
        release();
      }
    },
    query: { stores: { findFirst: async () => reservation.store } },
  },
  ExtensionError,
  cents: (amount: number) => Math.round(amount * 100),
  extensionFingerprint: fingerprint,
  loadExtensionReservation: async (
    _tx: unknown,
    storeId: string,
    reservationId: string,
    customerId?: string,
  ) => {
    if (
      storeId !== reservation.storeId ||
      reservationId !== reservation.id ||
      (customerId && customerId !== reservation.customerId)
    )
      throw new ExtensionError("notFound");
    return reservation;
  },
  parseExtensionEnd: () => requestedEnd,
  quoteExtension: async () => {
    if (unavailable) throw new ExtensionError("unavailable");
    return { preview: { mode: "automatic", supplement, total: 40, currency: "EUR" }, plan };
  },
  resolveDateChangeRequests: async () => {},
  toStripeCents: (amount: number) => Math.round(amount * 100),
  getStoreBilling: async () => ({}),
  planStripeFees: async () => ({ applicationFeeCents: 0 }),
  buildFeeMetadata: () => ({}),
  getStorefrontUrl: (_slug: string, path = "") => `https://example.invalid${path}`,
  generateContract: async () => {
    contractCalls++;
  },
  tryGenerateInvoiceForPayment: async () => ({}),
  markReservationForCalendarSync: async () => {},
  sendReservationModifiedEmail: async () => {
    emailCalls++;
  },
  getLocaleFromCountry: () => "en",
  log: { error: () => {} },
  stripe: {
    checkout: {
      sessions: {
        create: async () => {
          sessionCreates++;
          return { id: "cs_test", url: "https://checkout.stripe.com/test", status: "open" };
        },
        retrieve: async () => paidSession,
        expire: async () => ({ status: "expired" }),
      },
    },
    paymentIntents: { retrieve: async () => ({ id: "pi_test", latest_charge: "ch_test" }) },
    refunds: {
      create: async () => {
        refundCalls++;
        if (failRefund) throw new Error("temporary Stripe failure");
        return { id: "re_test", status: "succeeded" };
      },
    },
  },
};
Reflect.set(globalThis, "__louezExtensionTestDependencies", dependencies);
const intercepted = new Set([
  "@louez/db",
  "@/env",
  "@/lib/stripe/client",
  "@/lib/stripe",
  "@/lib/storefront-url",
  "@/lib/pay-as-you-go",
  "@/lib/pdf/generate",
  "@/lib/invoicing/service",
  "@/lib/integrations/calendar/sync",
  "@/lib/email/send",
  "@/lib/email/i18n",
  "@/lib/evlog",
  "./date-change-request.server",
  "./extension-quote",
]);
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    if (context.parentURL?.includes("extension-service.ts") && intercepted.has(specifier))
      return { url: pathToFileURL(fixturePath).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const load = () => import("./extension-service");
const input = {
  storeId: "store",
  customerId: "customer",
  reservationId: "reservation",
  endDate: "2030-06-12T10:00",
  expectedSupplement: 20,
};
const reset = () => {
  reservation = fresh();
  paymentRows = [];
  refundCalls = sessionCreates = emailCalls = contractCalls = 0;
  unavailable = failRefund = false;
  supplement = 20;
};
const makePaid = () => {
  paidSession = {
    id: "cs_test",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    currency: "eur",
    amount_total: 2000,
    payment_intent: "pi_test",
    metadata: { reservationId: "reservation", extensionId: reservation.activity[0].id },
  } as unknown as Stripe.Checkout.Session;
  return paidSession;
};

test("payment is required before applying dates; return and webhook replay write only one payment", async () => {
  reset();
  const service = await load();
  const result = await service.startExtension(input);
  assert.equal(result.status, "checkout");
  assert.equal(reservation.endDate.getTime(), originalEnd.getTime());
  assert.equal(reservation.activity[0].metadata.status, "checkout");
  const session = makePaid();
  assert.deepEqual(
    await Promise.all([
      service.completeExtensionPayment(session, "acct_test"),
      service.completeExtensionPayment(session, "acct_test"),
    ]),
    ["confirmed", "confirmed"],
  );
  assert.equal(paymentRows.length, 1);
  assert.equal(reservation.endDate.getTime(), requestedEnd.getTime());
  assert.equal(emailCalls, 2);
  assert.equal(contractCalls, 1);
});

test("a changed reservation or lost stock is refunded, never extended", async () => {
  const service = await load();
  for (const conflict of ["cancelled", "stock"]) {
    reset();
    await service.startExtension(input);
    const session = makePaid();
    if (conflict === "cancelled") reservation.status = "cancelled";
    else unavailable = true;
    assert.equal(await service.completeExtensionPayment(session, "acct_test"), "refunded");
    assert.equal(reservation.endDate.getTime(), originalEnd.getTime());
    assert.equal(refundCalls, 1);
    assert.equal(emailCalls, 0);
  }
});

test("a failed refund remains recoverable and is not duplicated after success", async () => {
  reset();
  const service = await load();
  await service.startExtension(input);
  const session = makePaid();
  unavailable = true;
  failRefund = true;
  await assert.rejects(service.completeExtensionPayment(session, "acct_test"), /temporary/);
  assert.equal(reservation.activity[0].metadata.status, "refund_pending");
  failRefund = false;
  assert.equal(await service.completeExtensionPayment(session, "acct_test"), "refunded");
  assert.equal(await service.completeExtensionPayment(session, "acct_test"), "refunded");
  assert.equal(paymentRows.length, 1);
  assert.equal(refundCalls, 2);
});

test("unpaid or mismatched sessions cannot extend a reservation", async () => {
  reset();
  const service = await load();
  await service.startExtension(input);
  const session = makePaid();
  assert.equal(
    await service.completeExtensionPayment({ ...session, payment_status: "unpaid" }, "acct_test"),
    "processing",
  );
  await assert.rejects(
    service.completeExtensionPayment({ ...session, amount_total: 1 }, "acct_test"),
    /paymentMismatch/,
  );
  assert.equal(paymentRows.length, 0);
  assert.equal(reservation.endDate.getTime(), originalEnd.getTime());
});

test("free extensions are idempotent and do not create a Stripe session", async () => {
  reset();
  supplement = 0;
  const service = await load();
  assert.equal(
    (await service.startExtension({ ...input, expectedSupplement: 0 })).status,
    "confirmed",
  );
  assert.equal(
    (await service.startExtension({ ...input, expectedSupplement: 0 })).status,
    "confirmed",
  );
  assert.equal(reservation.activity.length, 1);
  assert.equal(sessionCreates, 0);
  assert.equal(contractCalls, 1);
});

test("another customer cannot start an extension; stale displayed prices are refused", async () => {
  reset();
  const service = await load();
  await assert.rejects(service.startExtension({ ...input, customerId: "other" }), /notFound/);
  await assert.rejects(service.startExtension({ ...input, expectedSupplement: 1 }), /priceChanged/);
  assert.equal(reservation.activity.length, 0);
});

test("cancelling an unpaid checkout releases the hold, while a completed payment is reconciled", async () => {
  const service = await load();
  reset();
  await service.startExtension(input);
  makePaid();
  paidSession = { ...paidSession, status: "open", payment_status: "unpaid" };
  await service.cancelExtension("store", "reservation", "customer", reservation.activity[0].id);
  assert.equal(reservation.activity[0].metadata.status, "cancelled");
  assert.equal(reservation.endDate.getTime(), originalEnd.getTime());
  reset();
  await service.startExtension(input);
  makePaid();
  await service.cancelExtension("store", "reservation", "customer", reservation.activity[0].id);
  assert.equal(reservation.activity[0].metadata.status, "confirmed");
});
