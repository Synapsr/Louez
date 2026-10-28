import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { and, eq, inArray } from "drizzle-orm";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { DEFAULT_REFERRAL_PROGRAM_CONFIG } from "@/lib/referral/config";

// The legacy guard and the platform customer (louez-billing docs/api, README §8.3 and
// §8.4; design §4.8). In service mode, Louez's legacy code writes and bills nothing for
// a store the billing service bills, at the time of each fact, and never creates its
// platform customer. A legacy store, and every store without BILLING_SERVICE_URL, is
// billed as before. billing-off.test.ts covers LOUEZ_BILLING off.
//
// Times are relative to the real clock: new stores are those created from 2026-06-01,
// and the switched stores are billed by the service from 2026-09-01, both in the past.
//
// Stripe, the session, Next.js, analytics and Discord are stubs: no network call. The
// database is real.

process.env.SKIP_ENV_VALIDATION = "true";
process.env.AI_CREDIT_PACKAGES = '[{"credits":100,"priceCents":250}]';
// Onboarding scopes the referral cookie to the app's domain.
process.env.NEXT_PUBLIC_APP_DOMAIN = "localhost:3000";

type FakeInvoice = { id: string; customer: string; status: string; collection_method: string };

/** Stripe's platform account, in memory: the calls the tested code makes. */
function createFakeStripe() {
  const calls: string[] = [];
  const invoices = new Map<string, FakeInvoice>();
  const invoice = (id: string) => {
    const found = invoices.get(id);
    if (!found) throw new Error(`No such invoice: ${id}`);
    return found;
  };
  const field = (params: unknown, name: string) => String(Reflect.get(Object(params), name));
  return {
    calls,
    /** The invoices created, by id. */
    issued: invoices,
    reset() {
      calls.length = 0;
      invoices.clear();
    },
    customers: {
      async retrieve(id: string) {
        calls.push(`customers.retrieve ${id}`);
        return { id, object: "customer", invoice_settings: { default_payment_method: null } };
      },
      async create(params: unknown) {
        const id = `cus_Created_${field(Reflect.get(Object(params), "metadata"), "storeId")}`;
        calls.push(`customers.create ${id}`);
        return { id, object: "customer" };
      },
    },
    invoices: {
      async create(params: unknown) {
        const created: FakeInvoice = {
          id: `in_${invoices.size + 1}`,
          customer: field(params, "customer"),
          status: "draft",
          collection_method: field(params, "collection_method"),
        };
        invoices.set(created.id, created);
        calls.push(`invoices.create ${created.customer}`);
        return { ...created };
      },
      async retrieve(id: string) {
        return { ...invoice(id) };
      },
      async finalizeInvoice(id: string) {
        const found = invoice(id);
        found.status = "open";
        return { ...found };
      },
      async pay() {
        throw new Error("card_declined");
      },
    },
    invoiceItems: {
      async create(params: unknown) {
        calls.push(`invoiceItems.create ${field(params, "customer")} ${field(params, "amount")}`);
        return { id: `ii_${calls.length}`, object: "invoiceitem" };
      },
    },
    billingPortal: {
      sessions: {
        async create(params: unknown) {
          const customer = field(params, "customer");
          calls.push(`billingPortal.sessions.create ${customer}`);
          return { url: `https://billing.stripe.test/${customer}` };
        },
      },
    },
  };
}

const fakeStripe = createFakeStripe();
const productEvents: string[] = [];
const referralEvents: string[] = [];
const session: { userId: string; activeStoreId: string | null; referralCode: string } = {
  userId: "",
  activeStoreId: null,
  referralCode: "",
};
const currentStore = { id: "" };
const discord = {
  notifyBillingAlert: async (_kind: string, _message: string): Promise<void> => undefined,
};

/** What each stubbed module exports. A function is looked up at each call. */
const stubs: Record<string, Record<string, unknown>> = {
  "@/lib/stripe/client": {
    stripe: new Proxy(fakeStripe, {
      get(target, property) {
        const resource: unknown = Reflect.get(target, property);
        if (resource === undefined) throw new Error(`Stripe ${String(property)} is not stubbed`);
        return resource;
      },
    }),
    getStripe: () => Reflect.get(Reflect.get(stubs, "@/lib/stripe/client"), "stripe"),
    isConnectConfigured: () => false,
    stripeKeyMode: () => "test",
    getStripePublishableKey: () => undefined,
  },
  "@/lib/store-context": {
    getCurrentStore: async () => ({ id: currentStore.id, role: "owner" }),
    hasPermission: () => true,
    getActiveStoreId: async () => session.activeStoreId,
    setActiveStoreId: async () => ({ success: true }),
    verifyStoreAccess: async () => "owner",
  },
  "@/lib/auth": {
    auth: async () => ({ user: { id: session.userId, email: `${session.userId}@louez.test` } }),
  },
  "next/headers": {
    cookies: async () => ({
      get: (name: string) =>
        name === "louez_referral" && session.referralCode ? { value: session.referralCode } : undefined,
      set: () => undefined,
    }),
  },
  "next/cache": { revalidatePath: () => undefined, revalidateTag: () => undefined },
  "@/lib/acquisition/signup-origin": { getSignupOrigin: async () => null },
  "@/lib/product-analytics/analytics": {
    captureProductServerEvent: async (event: { event: string }) => {
      productEvents.push(event.event);
    },
  },
  "@/lib/referral/analytics": {
    captureReferralServerEvent: async (event: { event: string }) => {
      referralEvents.push(event.event);
    },
  },
  "@/lib/discord/platform-notifications": {
    notifyBillingAlert: (kind: string, message: string) => discord.notifyBillingAlert(kind, message),
  },
};
Reflect.set(globalThis, "__louezLegacyGuardStubs", stubs);
const directory = mkdtempSync(join(tmpdir(), "louez-legacy-guard-"));
after(() => rmSync(directory, { recursive: true }));
const stubUrls = new Map(
  Object.entries(stubs).map(([specifier, exports], index) => {
    const path = join(directory, `stub-${index}.cjs`);
    const source = `const stub = () => globalThis.__louezLegacyGuardStubs[${JSON.stringify(specifier)}];`;
    const lines = Object.entries(exports).map(([name, value]) =>
      typeof value === "function"
        ? `exports[${JSON.stringify(name)}] = (...args) => stub()[${JSON.stringify(name)}](...args);`
        : `exports[${JSON.stringify(name)}] = stub()[${JSON.stringify(name)}];`,
    );
    writeFileSync(path, [source, ...lines].join("\n"));
    return [specifier, pathToFileURL(path).href];
  }),
);
const stripeClientUrl = stubUrls.get("@/lib/stripe/client");

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    // Some modules import "server-only", which throws outside Next.
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    const stub = stubUrls.get(specifier);
    if (stub) return { url: stub, shortCircuit: true };
    const resolved = next(specifier, context);
    // The Stripe client is also imported as "./client".
    const url: unknown = Reflect.get(Object(resolved), "url");
    return typeof url === "string" && url.endsWith("/lib/stripe/client.ts")
      ? { url: stripeClientUrl, shortCircuit: true }
      : resolved;
  },
});

const NEW_STORES_FROM = "2026-06-01T00:00:00Z";
const OLD = "2026-05-01T00:00:00Z";
const NEW = "2026-07-01T00:00:00Z";
const AUGUST = new Date("2026-08-15T10:00:00Z");
const SEPTEMBER = new Date("2026-09-15T10:00:00Z");
const JUNE = new Date("2026-06-01T00:00:00Z");
const PAYMENT_METHOD_LINK = "/dashboard/billing?to=/payment-method";
const REFERRAL_CODE = "LOUEZREFERAB";

const base = {
  schema: "louez.billing.policy/1",
  issuedAt: "2026-04-20T10:00:00Z",
  newStoresCreatedFrom: null,
  currency: "EUR",
  applicationFee: { kind: "none" },
  marketplaceFeeMinor: 150,
  reservations: { allowed: true },
  notice: null,
  stripeCustomerId: null,
  labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
};
const DEFAULT_V1 = {
  ...base,
  storeId: "*",
  version: 1,
  effectiveFrom: NEW_STORES_FROM,
  newStoresCreatedFrom: NEW_STORES_FROM,
  offerKey: "test-commission",
  invoicing: "service",
};
/** A store created before the cutoff whose version moves it to the service (as at B). */
const switched = (storeId: string, serviceCustomer: string | null = "cus_SwitchedService") => [
  {
    ...base,
    storeId,
    version: 1,
    effectiveFrom: "2026-05-01T00:00:00Z",
    offerKey: "test-legacy",
    invoicing: "louez_legacy",
  },
  {
    ...base,
    storeId,
    version: 2,
    effectiveFrom: "2026-09-01T00:00:00Z",
    offerKey: "test-commission",
    invoicing: "service",
    stripeCustomerId: serviceCustomer,
  },
];
const POLICIES = [
  DEFAULT_V1,
  ...switched("lg_switch"),
  ...switched("lg_run_switch"),
  ...switched("lg_month_row"),
  ...switched("lg_month_nocus", null),
  {
    ...base,
    storeId: "lg_new_card",
    version: 1,
    effectiveFrom: NEW,
    offerKey: "test-commission",
    invoicing: "service",
    stripeCustomerId: "cus_ServiceNewCard",
  },
  {
    ...base,
    storeId: "lg_adopted",
    version: 1,
    effectiveFrom: OLD,
    offerKey: "test-legacy",
    invoicing: "louez_legacy",
    stripeCustomerId: "cus_AdoptedLegacy",
  },
];

const STORES: ReadonlyArray<readonly [string, string]> = [
  ["lg_old", OLD],
  ["lg_old_rowless", OLD],
  ["lg_old_row", OLD],
  ["lg_adopted", OLD],
  ["lg_switch", OLD],
  ["lg_new", NEW],
  ["lg_new_card", NEW],
  ["lg_new_stale", NEW],
  ["lg_new_referred", NEW],
  ["lg_run_old", OLD],
  ["lg_run_switch", OLD],
  ["lg_run_new", NEW],
  ["lg_month_row", OLD],
  ["lg_month_nocus", OLD],
  ["lg_referrer", OLD],
];

describe("legacy guard and platform customer (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let lock: typeof import("@/lib/pay-as-you-go/pricing-lock");
  let newStore: typeof import("@/lib/pay-as-you-go/new-store-subscription");
  let metering: typeof import("@/lib/pay-as-you-go/metering");
  let billing: typeof import("@/lib/pay-as-you-go/billing");
  let marketplace: typeof import("@/lib/pay-as-you-go/marketplace-fee-core");
  let customers: typeof import("@/lib/stripe/subscriptions");
  let smsTopup: typeof import("@/lib/stripe/sms-topup");
  let aiTopup: typeof import("@/lib/stripe/ai-credit-topup");
  let requireBilling: typeof import("./require-billing");
  let rewards: typeof import("@/lib/referral/rewards");
  let legacyRun: typeof import("@/lib/pay-as-you-go/legacy-run");
  let autoTopup: typeof import("@/lib/ai/advisor/auto-topup");
  let subscriptionActions: typeof import("@/app/(dashboard)/dashboard/subscription/actions");
  let onboarding: typeof import("@/app/(dashboard)/onboarding/actions");
  const names = [
    "LOUEZ_BILLING",
    "BILLING_SERVICE_URL",
    "BILLING_NEW_STORES_FROM",
    "LOUEZ_MODE",
  ] as const;
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  let feeCounter = 0;

  before(async () => {
    database = await createTestDatabase("legacy_guard");
    louezDb = await import("@louez/db");
    lock = await import("@/lib/pay-as-you-go/pricing-lock");
    newStore = await import("@/lib/pay-as-you-go/new-store-subscription");
    metering = await import("@/lib/pay-as-you-go/metering");
    billing = await import("@/lib/pay-as-you-go/billing");
    marketplace = await import("@/lib/pay-as-you-go/marketplace-fee-core");
    customers = await import("@/lib/stripe/subscriptions");
    smsTopup = await import("@/lib/stripe/sms-topup");
    aiTopup = await import("@/lib/stripe/ai-credit-topup");
    requireBilling = await import("./require-billing");
    rewards = await import("@/lib/referral/rewards");
    legacyRun = await import("@/lib/pay-as-you-go/legacy-run");
    autoTopup = await import("@/lib/ai/advisor/auto-topup");
    subscriptionActions = await import("@/app/(dashboard)/dashboard/subscription/actions");
    onboarding = await import("@/app/(dashboard)/onboarding/actions");

    await louezDb.db.insert(louezDb.stores).values(
      STORES.map(([id, createdAt]) => ({
        id,
        userId: `user_${id}`,
        name: id,
        slug: id.replaceAll("_", "-"),
        createdAt: new Date(createdAt),
        ...(id === "lg_referrer" ? { referralCode: REFERRAL_CODE } : {}),
      })),
    );
    await louezDb.db.insert(louezDb.billingPolicies).values(
      POLICIES.map((body) => ({
        storeId: body.storeId,
        version: body.version,
        effectiveFrom: new Date(body.effectiveFrom),
        body,
      })),
    );
    const row = (storeId: string, values: { stripeCustomerId?: string; updatedAt?: Date }) => ({
      id: `sub_${storeId}`.slice(0, 21),
      storeId,
      billingMode: "pay_as_you_go" as const,
      payAsYouGoConfig: { flatRateCents: 123 },
      pricingVersion: "payg-ladder-v1" as const,
      freeReservationsGranted: 0,
      ...values,
    });
    await louezDb.db
      .insert(louezDb.subscriptions)
      .values([
        row("lg_old_row", { stripeCustomerId: "cus_LegacyRow" }),
        // A row may exist for a store the service bills; it means nothing for billing.
        row("lg_new_stale", { stripeCustomerId: "cus_StaleRow" }),
        row("lg_new_card", { stripeCustomerId: "cus_StaleRowCard" }),
        row("lg_run_old", { updatedAt: JUNE }),
        row("lg_run_switch", { updatedAt: JUNE }),
        row("lg_run_new", { updatedAt: new Date("2026-07-15T00:00:00Z") }),
        row("lg_month_row", { stripeCustomerId: "cus_LouezOwn", updatedAt: JUNE }),
      ]);
  });
  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });
  beforeEach(() => {
    process.env.LOUEZ_BILLING = "cloud";
    process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
    process.env.BILLING_NEW_STORES_FROM = NEW_STORES_FROM;
    fakeStripe.reset();
  });
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  async function subscriptionRow(storeId: string) {
    return louezDb.db.query.subscriptions.findFirst({
      where: eq(louezDb.subscriptions.storeId, storeId),
      columns: { freeReservationsGranted: true, payAsYouGoConfig: true },
    });
  }

  async function legacyStoreMarks(storeIds: readonly string[]) {
    const queue = louezDb.billingSyncQueue;
    const rows = await louezDb.db
      .select({ storeId: queue.aggregateId })
      .from(queue)
      .where(and(eq(queue.aggregateType, "legacy_store"), inArray(queue.aggregateId, [...storeIds])));
    return rows.map((mark) => mark.storeId).sort();
  }

  async function addFee(
    storeId: string,
    values: {
      status: "pending" | "collected";
      source: "manual" | "online";
      feeId?: string;
      billingMonth?: string;
    },
  ) {
    const id = `fee_lg_${++feeCounter}`;
    await louezDb.db.insert(louezDb.platformFees).values({
      id,
      storeId,
      reservationId: `res_${id}`,
      dedupKey: `res:res_${id}`,
      amountCents: 150,
      currency: "eur",
      source: values.source,
      status: values.status,
      billingMonth: values.billingMonth ?? "2026-08",
      monthlyIndex: 1,
      stripeApplicationFeeId: values.feeId ?? null,
    });
    return { id, reservationId: `res_${id}` };
  }

  async function feeRow(id: string) {
    return louezDb.db.query.platformFees.findFirst({
      where: eq(louezDb.platformFees.id, id),
      columns: { status: true, amountReversedCents: true },
    });
  }

  test("a store the service bills gets no legacy row, allowance or mark; a legacy store does", async () => {
    for (const storeId of ["lg_new", "lg_switch"]) {
      await lock.ensureSubscriptionRow(louezDb.db, storeId);
      await lock.addFreeReservations(louezDb.db, storeId, 10);
      await lock.raiseFreeReservations(louezDb.db, storeId, 30);
      assert.equal(await subscriptionRow(storeId), undefined, storeId);
    }
    assert.deepEqual(await legacyStoreMarks(["lg_new", "lg_switch"]), []);

    await lock.ensureSubscriptionRow(louezDb.db, "lg_old_rowless");
    await lock.raiseFreeReservations(louezDb.db, "lg_old_rowless", 30);
    assert.equal((await subscriptionRow("lg_old_rowless"))?.freeReservationsGranted, 30);
    assert.deepEqual(await legacyStoreMarks(["lg_old_rowless"]), ["lg_old_rowless"]);
  });

  test("onboarding writes no legacy pricing for a new store, in the transaction that creates it", async () => {
    const created = async (id: string, createdAt?: Date) =>
      louezDb.db.transaction(async (tx) => {
        await tx.insert(louezDb.stores).values({
          id,
          userId: `user_${id}`,
          name: id,
          slug: id.replaceAll("_", "-"),
          ...(createdAt ? { createdAt } : {}),
        });
        return newStore.insertNewStoreSubscription(tx, {
          storeId: id,
          currency: "eur",
          referred: false,
        });
      });

    // Created now, after the cutoff: the service bills it.
    assert.equal(await created("lg_onboard_new"), false);
    assert.equal(await subscriptionRow("lg_onboard_new"), undefined);

    // Before the cutoff, read inside the uncommitted transaction: Louez bills it, and
    // the row is marked in the store's legacy snapshot.
    assert.equal(await created("lg_onboard_old", new Date(OLD)), true);
    assert.ok((await subscriptionRow("lg_onboard_old"))?.payAsYouGoConfig);
    assert.deepEqual(await legacyStoreMarks(["lg_onboard_new", "lg_onboard_old"]), [
      "lg_onboard_old",
    ]);

    // Without BILLING_SERVICE_URL every store is legacy, as before.
    delete process.env.BILLING_SERVICE_URL;
    assert.equal(await created("lg_onboard_cloud"), true);
    assert.ok(await subscriptionRow("lg_onboard_cloud"));
  });

  test("no legacy fee is planned or recorded for a store the service bills at the time of the fact", async () => {
    const plan = (storeId: string, reference?: Date) =>
      metering.planStripeFees({
        storeId,
        reservationId: `res_plan_${storeId}`,
        chargeCents: 300,
        includeMarketplaceFee: true,
        ...(reference ? { reference } : {}),
      });
    const none = { applicationFeeCents: 0, reservationFeeCents: 0, marketplaceFeeCents: 0 };
    const fee = marketplace.MARKETPLACE_FEE_CENTS;
    assert.deepEqual(await plan("lg_new"), none);
    assert.deepEqual(await plan("lg_switch"), none);
    assert.equal((await plan("lg_switch", AUGUST)).marketplaceFeeCents, fee);
    assert.equal((await plan("lg_old")).marketplaceFeeCents, fee);

    const record = (storeId: string, reservationId: string, at: Date) =>
      metering.recordReservationFee({ storeId, reservationId, source: "manual", at });
    assert.deepEqual(await record("lg_new", "res_lg_new", AUGUST), {
      recorded: false,
      reason: "not_legacy_billed",
    });
    assert.deepEqual(await record("lg_switch", "res_lg_switch_sep", SEPTEMBER), {
      recorded: false,
      reason: "not_legacy_billed",
    });
    assert.equal((await record("lg_switch", "res_lg_switch_aug", AUGUST)).recorded, true);
    assert.deepEqual(
      await metering.recordMarketplaceFee({
        storeId: "lg_new",
        reservationId: "res_lg_new_mkt",
        source: "manual",
        at: AUGUST,
      }),
      { recorded: false, reason: "not_legacy_billed" },
    );
    assert.equal(
      (
        await metering.recordMarketplaceFee({
          storeId: "lg_old",
          reservationId: "res_lg_old_mkt",
          source: "manual",
          at: AUGUST,
        })
      ).recorded,
      true,
    );

    const written = await louezDb.db
      .select({ reservationId: louezDb.platformFees.reservationId })
      .from(louezDb.platformFees)
      .where(inArray(louezDb.platformFees.storeId, ["lg_new", "lg_switch", "lg_old"]));
    assert.deepEqual(written.map((row) => row.reservationId).sort(), [
      "res_lg_old_mkt",
      "res_lg_switch_aug",
    ]);
  });

  test("a cancellation or a fee refund changes a legacy row when the monthly run bills its month", async () => {
    // lg_switch is billed by the service from September: the run still bills its August.
    const august = await addFee("lg_switch", { status: "pending", source: "manual" });
    const september = await addFee("lg_switch", {
      status: "pending",
      source: "manual",
      billingMonth: "2026-09",
    });
    const fresh = await addFee("lg_new", { status: "pending", source: "manual" });
    assert.deepEqual(await metering.voidReservationFee(august.reservationId), { voided: true });
    assert.deepEqual(await metering.voidReservationFee(september.reservationId), { voided: false });
    assert.deepEqual(await metering.voidReservationFee(fresh.reservationId), { voided: false });
    assert.deepEqual(
      [(await feeRow(september.id))?.status, (await feeRow(fresh.id))?.status],
      ["pending", "pending"],
    );

    const refunded = [
      await addFee("lg_switch", { status: "collected", source: "online", feeId: "fee_sw_aug" }),
      await addFee("lg_switch", {
        status: "collected",
        source: "online",
        feeId: "fee_sw_sep",
        billingMonth: "2026-09",
      }),
      await addFee("lg_old", { status: "collected", source: "online", feeId: "fee_old_aug" }),
    ];
    for (const applicationFeeId of ["fee_sw_aug", "fee_sw_sep", "fee_old_aug"]) {
      await metering.recordApplicationFeeRefund(
        { applicationFeeId, paymentIntentId: null, feeRefundedMinor: 50 },
        louezDb.db,
      );
    }
    const reversed = await Promise.all(
      refunded.map(async (fee) => (await feeRow(fee.id))?.amountReversedCents),
    );
    assert.deepEqual(reversed, [50, 0, 50]);
  });

  test("a fee collected after the switch settles a pending row of a month the run still bills", async () => {
    // Confirmed by hand in August, paid online in September, once the service bills lg_switch.
    const august = await addFee("lg_switch", { status: "pending", source: "manual" });
    const collect = (reservationId: string) =>
      metering.recordReservationFee({
        storeId: "lg_switch",
        reservationId,
        source: "online",
        collectedAmountCents: 150,
        stripePaymentIntentId: `pi_${reservationId}`,
        at: SEPTEMBER,
      });
    assert.deepEqual(await collect(august.reservationId), {
      recorded: true,
      reason: "upgraded_to_collected",
    });
    assert.equal((await feeRow(august.id))?.status, "collected");

    const addMarketplaceFee = async (fee: { id: string; reservationId: string }, month: string) => {
      await louezDb.db.insert(louezDb.platformFees).values({
        id: `${fee.id}_mkt`,
        storeId: "lg_switch",
        reservationId: fee.reservationId,
        dedupKey: `mkt:${fee.reservationId}`,
        amountCents: marketplace.MARKETPLACE_FEE_CENTS,
        currency: "eur",
        source: "marketplace_manual",
        status: "pending",
        billingMonth: month,
        monthlyIndex: null,
      });
      return `${fee.id}_mkt`;
    };
    const collectMarketplace = (reservationId: string) =>
      metering.recordMarketplaceFee({
        storeId: "lg_switch",
        reservationId,
        source: "online",
        collectedAmountCents: marketplace.MARKETPLACE_FEE_CENTS,
        at: SEPTEMBER,
      });
    const augustMarketplace = await addMarketplaceFee(august, "2026-08");
    assert.deepEqual(await collectMarketplace(august.reservationId), {
      recorded: true,
      reason: "upgraded_to_collected",
    });
    assert.equal((await feeRow(augustMarketplace))?.status, "collected");

    // A September row is the service's: the run never bills it, so it stays as it is.
    const september = await addFee("lg_switch", {
      status: "pending",
      source: "manual",
      billingMonth: "2026-09",
    });
    assert.deepEqual(await collect(september.reservationId), {
      recorded: false,
      reason: "not_legacy_billed",
    });
    assert.equal((await feeRow(september.id))?.status, "pending");
    const septemberMarketplace = await addMarketplaceFee(september, "2026-09");
    assert.deepEqual(await collectMarketplace(september.reservationId), {
      recorded: false,
      reason: "not_legacy_billed",
    });
    assert.equal((await feeRow(septemberMarketplace))?.status, "pending");
  });

  test("the monthly run leaves out a store the service bills at the end of the month", async () => {
    const august = await billing.monthlyBillingStoreIds("2026-08");
    const september = await billing.monthlyBillingStoreIds("2026-09");
    assert.ok(august.includes("lg_run_old") && august.includes("lg_run_switch"));
    assert.ok(september.includes("lg_run_old"));
    assert.ok(!september.includes("lg_run_switch"), "billed by the service from September");
    assert.ok(!august.includes("lg_run_new") && !september.includes("lg_run_new"));

    // Without BILLING_SERVICE_URL the run bills every store it finds, as before.
    delete process.env.BILLING_SERVICE_URL;
    assert.ok((await billing.monthlyBillingStoreIds("2026-09")).includes("lg_run_new"));
  });

  test("a store's last legacy month is invoiced to its customer at the end of the month", async () => {
    // Both stores are billed by the service from September; lg_month_row's version
    // then carries the service's customer, lg_month_nocus has none, nor any of Louez.
    for (const storeId of ["lg_month_row", "lg_month_nocus"]) {
      await addFee(storeId, { status: "pending", source: "manual" });
    }
    assert.ok((await billing.monthlyBillingStoreIds("2026-08")).includes("lg_month_row"));
    await assert.rejects(
      customers.getLegacyPlatformCustomerId("lg_month_row"),
      /billed by the billing service/,
    );

    for (const storeId of ["lg_month_row", "lg_month_nocus"]) {
      const outcome = await billing.billStoreForMonth(storeId, "2026-08");
      assert.deepEqual(
        { status: outcome.status, invoicedCents: outcome.invoicedCents },
        { status: "open", invoicedCents: 150 },
        storeId,
      );
    }
    assert.deepEqual(
      [...fakeStripe.issued.values()].map((invoice) => invoice.customer),
      ["cus_LouezOwn", "cus_Created_lg_month_nocus"],
    );
    // The new customer is kept on the store's row, so a retry creates no second one.
    const created = await louezDb.db.query.subscriptions.findFirst({
      where: eq(louezDb.subscriptions.storeId, "lg_month_nocus"),
      columns: { stripeCustomerId: true },
    });
    assert.equal(created?.stripeCustomerId, "cus_Created_lg_month_nocus");
  });

  test("the cron's catch-up reads no policy once every due store has its invoice row", async () => {
    // Every store due for July, the guard aside, gets a row, as a run that reached it.
    delete process.env.BILLING_SERVICE_URL;
    const due = await billing.monthlyBillingStoreIds("2026-07");
    process.env.BILLING_SERVICE_URL = "http://127.0.0.1:1";
    assert.ok(due.includes("lg_run_new"), "a new store is due before the guard");
    await louezDb.db.insert(louezDb.payAsYouGoInvoices).values(
      due.map((storeId) => ({
        id: `inv_${storeId}`.slice(0, 21),
        storeId,
        billingMonth: "2026-07",
        currency: "eur",
        status: "void" as const,
      })),
    );

    const pool = louezDb.db.$client;
    const query: unknown = Reflect.get(pool, "query");
    if (typeof query !== "function") throw new Error("the pool has no query method");
    const statements: string[] = [];
    Reflect.set(pool, "query", (...args: unknown[]) => {
      const [first] = args;
      statements.push(typeof first === "string" ? first : String(Reflect.get(Object(first), "sql")));
      return Reflect.apply(query, pool, args);
    });
    try {
      assert.deepEqual(await legacyRun.unbilledStoreIds("2026-07"), []);
    } finally {
      Reflect.deleteProperty(pool, "query");
    }
    assert.ok(statements.length > 0, "the spy saw the run's queries");
    assert.deepEqual(
      statements.filter((statement) => statement.includes("billing_policies")),
      [],
    );
  });

  test("the platform customer comes from the policy, then the row; none is created for a store the service bills", async () => {
    assert.equal(await customers.getPlatformCustomerId("lg_new_card"), "cus_ServiceNewCard");
    assert.equal(await customers.getPlatformCustomerId("lg_switch"), "cus_SwitchedService");
    // The stale row's customer is not the store's: only the service holds it.
    assert.equal(await customers.getPlatformCustomerId("lg_new_stale"), null);
    assert.equal(await customers.hasStripeCustomer("lg_new_stale"), false);
    assert.equal(await customers.getPlatformCustomerId("lg_new"), null);
    assert.equal(await subscriptionRow("lg_new"), undefined);

    // A charge of Louez's own billing refuses a store the service bills, customer or not.
    await assert.rejects(
      customers.getLegacyPlatformCustomerId("lg_new_card"),
      /billed by the billing service/,
    );

    // Legacy stores: the adopted customer of a louez_legacy version, else Louez's own.
    assert.equal(await customers.getPlatformCustomerId("lg_adopted"), "cus_AdoptedLegacy");
    assert.equal(await customers.getPlatformCustomerId("lg_old_row"), "cus_LegacyRow");
    assert.equal(await customers.hasStripeCustomer("lg_old_row"), true);

    delete process.env.BILLING_SERVICE_URL;
    assert.equal(await customers.getPlatformCustomerId("lg_new_stale"), "cus_StaleRow");
  });

  test("a top-up of a store the service bills without a customer links to the card page and starts nothing", async () => {
    const sms = await smsTopup.createSmsTopupCheckoutSession({
      storeId: "lg_new",
      quantity: 100,
      successUrl: "https://app.test/ok",
      cancelUrl: "https://app.test/cancel",
      translations: { productName: "SMS", productDescription: "SMS" },
    });
    assert.deepEqual(sms, { sessionId: null, url: PAYMENT_METHOD_LINK });

    const ai = await aiTopup.createAiCreditTopupCheckoutSession({
      storeId: "lg_new",
      pack: { credits: 100, priceCents: 250 },
      successUrl: "https://app.test/ok",
      cancelUrl: "https://app.test/cancel",
      translations: { productName: "AI", productDescription: "AI" },
    });
    assert.deepEqual(ai, { sessionId: null, url: PAYMENT_METHOD_LINK });

    const [smsRows, aiRows] = await Promise.all([
      louezDb.db
        .select({ id: louezDb.smsTopupTransactions.id })
        .from(louezDb.smsTopupTransactions)
        .where(eq(louezDb.smsTopupTransactions.storeId, "lg_new")),
      louezDb.db
        .select({ id: louezDb.aiCreditTransactions.id })
        .from(louezDb.aiCreditTransactions)
        .where(eq(louezDb.aiCreditTransactions.storeId, "lg_new")),
    ]);
    assert.deepEqual([smsRows, aiRows], [[], []]);
  });

  test("an off-session charge needs the store's own customer, checked in its metadata", async () => {
    const alerts: string[] = [];
    const fakeAlerts = {
      log: { error: () => undefined, info: () => undefined },
      alert: async (kind: string, message: string) => {
        alerts.push(`${kind}: ${message}`);
      },
    };
    const card = { default_payment_method: "pm_card" };
    const retrieving = (metadata: Record<string, string>) => async (id: string) => ({
      id,
      metadata,
      invoice_settings: card,
    });

    assert.deepEqual(
      await customers.getOffSessionCustomer("lg_new_card", {
        alerts: fakeAlerts,
        retrieveCustomer: retrieving({ billing_store_id: "lg_new_card", issuer: "louez-billing" }),
      }),
      { ok: true, customerId: "cus_ServiceNewCard" },
    );
    assert.deepEqual(
      await customers.getOffSessionCustomer("lg_old_row", {
        alerts: fakeAlerts,
        retrieveCustomer: retrieving({ storeId: "lg_old_row" }),
      }),
      { ok: true, customerId: "cus_LegacyRow" },
    );
    assert.deepEqual(alerts, []);

    assert.deepEqual(
      await customers.getOffSessionCustomer("lg_new_card", {
        alerts: fakeAlerts,
        retrieveCustomer: retrieving({ billing_store_id: "lg_other", storeId: "lg_new_card" }),
      }),
      { ok: false, reason: "other_store" },
    );
    assert.equal(alerts.length, 1);
    assert.match(alerts[0] ?? "", /^platform_customer_mismatch: .*cus_ServiceNewCard.*lg_other/);

    let retrieved = false;
    assert.deepEqual(
      await customers.getOffSessionCustomer("lg_new", {
        alerts: fakeAlerts,
        retrieveCustomer: async (id) => {
          retrieved = true;
          return { id };
        },
      }),
      { ok: false, reason: "no_customer" },
    );
    assert.equal(retrieved, false);
  });

  test("the auto top-up charges only the store's own customer, with an alert otherwise", async () => {
    const alerts: string[] = [];
    const fakeAlerts = {
      log: { error: () => undefined, info: () => undefined },
      alert: async (kind: string, message: string) => {
        alerts.push(`${kind}: ${message}`);
      },
    };
    const retrieving = (metadata: Record<string, string>) => async (id: string) => ({
      id,
      metadata,
      invoice_settings: { default_payment_method: "pm_card" },
    });
    await louezDb.db.insert(louezDb.aiCredits).values(
      ["lg_old_row", "lg_new_card"].map((storeId) => ({
        storeId,
        balanceMicro: 0,
        autoTopupEnabled: true,
        autoTopupCredits: 100,
        autoTopupPriceCents: 250,
        autoTopupThresholdMicro: 1_000_000,
      })),
    );

    // lg_old_row's customer names another store: no invoice, the attempt fails.
    await autoTopup.maybeTriggerAutoTopup("lg_old_row", {
      alerts: fakeAlerts,
      retrieveCustomer: retrieving({ storeId: "lg_other" }),
    });
    await autoTopup.maybeTriggerAutoTopup("lg_new_card", {
      alerts: fakeAlerts,
      retrieveCustomer: retrieving({ billing_store_id: "lg_new_card", issuer: "louez-billing" }),
    });

    const attempts = await louezDb.db
      .select({
        storeId: louezDb.aiCreditTransactions.storeId,
        status: louezDb.aiCreditTransactions.status,
        stripeInvoiceId: louezDb.aiCreditTransactions.stripeInvoiceId,
      })
      .from(louezDb.aiCreditTransactions)
      .where(inArray(louezDb.aiCreditTransactions.storeId, ["lg_old_row", "lg_new_card"]));
    assert.deepEqual(
      attempts.sort((a, b) => a.storeId.localeCompare(b.storeId)),
      [
        { storeId: "lg_new_card", status: "pending", stripeInvoiceId: "in_1" },
        { storeId: "lg_old_row", status: "failed", stripeInvoiceId: null },
      ],
    );
    assert.deepEqual(
      [...fakeStripe.issued.values()].map((invoice) => invoice.customer),
      ["cus_ServiceNewCard"],
    );
    assert.equal(alerts.length, 1);
    assert.match(alerts[0] ?? "", /^platform_customer_mismatch: .*cus_LegacyRow.*lg_other/);
  });

  test("a refused off-session charge answers before the alert reaches Discord", async () => {
    // Discord never answers: the check must not wait for it, outside a request too.
    let reached: (message: string) => void = () => undefined;
    const posted = new Promise<string>((resolve) => {
      reached = resolve;
    });
    discord.notifyBillingAlert = async (kind, message) => {
      reached(`${kind}: ${message}`);
      return new Promise<void>(() => undefined);
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<"waited">((resolve) => {
      timer = setTimeout(() => resolve("waited"), 5_000);
    });
    try {
      const answer = await Promise.race([
        customers.getOffSessionCustomer("lg_new_card", {
          retrieveCustomer: async (id) => ({
            id,
            metadata: { billing_store_id: "lg_elsewhere" },
            invoice_settings: { default_payment_method: "pm_card" },
          }),
        }),
        waited,
      ]);
      assert.deepEqual(answer, { ok: false, reason: "other_store" });
      assert.match(await posted, /^platform_customer_mismatch: .*lg_elsewhere/);
    } finally {
      clearTimeout(timer);
      discord.notifyBillingAlert = async () => undefined;
    }
  });

  test("the pay-as-you-go pages send a store the service bills to its billing pages", async () => {
    await assert.rejects(requireBilling.requireLegacyBilling("lg_new"), (error: unknown) =>
      String(error instanceof Error ? Reflect.get(error, "digest") : "").includes(
        ";/dashboard/billing?to=/;",
      ),
    );
    await requireBilling.requireLegacyBilling("lg_old");
  });

  test("the plan and card actions send a store the service bills to its billing pages", async () => {
    // No customer, or the service's: the card page, and no Stripe call.
    for (const storeId of ["lg_new", "lg_new_card"]) {
      currentStore.id = storeId;
      assert.deepEqual(await subscriptionActions.openBillingPortal(), { url: PAYMENT_METHOD_LINK });
      assert.deepEqual(
        await subscriptionActions.createCheckoutSession({
          planSlug: "pro",
          interval: "monthly",
          currency: "eur",
        }),
        { error: "Plans are not available for this store", url: null },
      );
    }
    assert.deepEqual(fakeStripe.calls, []);
    assert.equal(await subscriptionRow("lg_new"), undefined);

    // A legacy store keeps Louez's portal and plans.
    currentStore.id = "lg_old_row";
    assert.deepEqual(await subscriptionActions.openBillingPortal(), {
      url: "https://billing.stripe.test/cus_LegacyRow",
    });
    assert.deepEqual(
      await subscriptionActions.createCheckoutSession({
        planSlug: "no-such-plan",
        interval: "monthly",
        currency: "eur",
      }),
      { error: "Plan not found", url: null },
    );
  });

  test("onboarding gives the referred welcome reward and its event only to a legacy store", async () => {
    process.env.LOUEZ_MODE = "platform";
    session.referralCode = REFERRAL_CODE;
    const storeInfo = (slug: string) => ({ name: slug, slug, country: "FR", currency: "EUR" });
    const signUp = async (userId: string) => {
      session.userId = userId;
      session.activeStoreId = null;
      productEvents.length = 0;
      referralEvents.length = 0;
      await louezDb.db.insert(louezDb.users).values({ id: userId, email: `${userId}@louez.test` });
    };
    const storeOf = async (userId: string) => {
      const found = await louezDb.db.query.stores.findFirst({
        where: eq(louezDb.stores.userId, userId),
        columns: { id: true, referredByStoreId: true },
      });
      assert.ok(found, userId);
      return found;
    };
    const REWARD_EVENT = "referral_referred_reward_granted";

    // A new store, created now: the service bills it.
    await signUp("u_onboard_service");
    assert.deepEqual(await onboarding.createStore(storeInfo("lg-onboard-service")), {
      success: true,
    });
    const service = await storeOf("u_onboard_service");
    assert.equal(service.referredByStoreId, "lg_referrer");
    assert.equal(await subscriptionRow(service.id), undefined);
    assert.ok(referralEvents.length > 0 && !referralEvents.includes(REWARD_EVENT));

    // An incomplete store finishing onboarding with a referral: the same.
    await signUp("u_resume_service");
    const [resumed] = await louezDb.db
      .insert(louezDb.stores)
      .values({ userId: "u_resume_service", name: "resume", slug: "lg-resume-service" })
      .$returningId();
    assert.ok(resumed);
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: resumed.id, userId: "u_resume_service", role: "owner" });
    session.activeStoreId = resumed.id;
    assert.deepEqual(await onboarding.createStore(storeInfo("lg-resume-service")), {
      success: true,
    });
    assert.equal(await subscriptionRow(resumed.id), undefined);
    assert.ok(referralEvents.length > 0 && !referralEvents.includes(REWARD_EVENT));

    // Without BILLING_SERVICE_URL every store is legacy: the row and the event, as before.
    delete process.env.BILLING_SERVICE_URL;
    await signUp("u_onboard_legacy");
    assert.deepEqual(await onboarding.createStore(storeInfo("lg-onboard-legacy")), {
      success: true,
    });
    const legacy = await storeOf("u_onboard_legacy");
    assert.ok((await subscriptionRow(legacy.id))?.payAsYouGoConfig);
    assert.ok(referralEvents.includes(REWARD_EVENT));
    assert.ok(productEvents.length > 0);

    session.referralCode = "";
  });

  test("a referrer the service bills gets no legacy reward", async () => {
    assert.deepEqual(
      await rewards.maybeGrantReferrerReward({
        referredStore: {
          id: "lg_new_referred",
          name: "lg_new_referred",
          referredByStoreId: "lg_new",
          referredByUserId: null,
        },
        qualifyingAmountCents: DEFAULT_REFERRAL_PROGRAM_CONFIG.minQualifyingAmountCents,
        currency: "eur",
        reservationId: "res_lg_referral",
      }),
      { granted: false, reason: "referrer_not_legacy_billed" },
    );
  });
});
