import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { and, eq, inArray } from "drizzle-orm";
import Stripe from "stripe";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { AdminSettingsInput } from "@/app/(dashboard)/dashboard/settings/admin/actions";
import { DEFAULT_REFERRAL_PROGRAM_CONFIG } from "@/lib/referral/config";

// The legacy guard and the platform customer (louez-billing docs/api, README §8.3 and
// §8.4; design §4.8). In service mode, Louez's legacy code writes and bills nothing for
// a store the billing service bills, at the time of each fact, and creates its platform
// customer only for a plan checkout. A legacy store, and every store without
// BILLING_SERVICE_URL, is billed as before. Louez's plans, for every store (§8.7): one
// live subscription per store, changed in place once Stripe has charged the difference,
// its status and plan written by the platform webhook, and a change that would leave a
// credit put off to the end of the paid period with a schedule, which every other update
// releases first; one open plan Checkout per store,
// and a second plan paid through another one never replaces the first; a row whose
// subscription Stripe has ended goes back to pay-as-you-go instead of blocking a plan.
// Each write that starts, changes or ends a plan asks for the early sync once
// (syncPlanSoon, plans-for-new-stores decision 8), and no other write does.
// billing-off.test.ts covers LOUEZ_BILLING off.
//
// Times are relative to the real clock: new stores are those created from 2026-06-01,
// and the switched stores are billed by the service from 2026-09-01, both in the past.
//
// Stripe, the session, Next.js, analytics, Discord and the early plan sync are stubs: no
// network call. The database is real.

process.env.SKIP_ENV_VALIDATION = "true";
process.env.AI_CREDIT_PACKAGES = '[{"credits":100,"priceCents":250}]';
// Onboarding scopes the referral cookie to the app's domain.
process.env.NEXT_PUBLIC_APP_DOMAIN = "localhost:3000";
// The plans' test prices, read when the app's env loads.
const PRICE = {
  proMonthly: "price_test_pro_month",
  proYearly: "price_test_pro_year",
  ultraMonthly: "price_test_ultra_month",
  ultraYearly: "price_test_ultra_year",
  proMonthlyUsd: "price_test_pro_month_usd",
} as const;
process.env.STRIPE_PRICE_PRO_MONTHLY = PRICE.proMonthly;
process.env.STRIPE_PRICE_PRO_YEARLY = PRICE.proYearly;
process.env.STRIPE_PRICE_ULTRA_MONTHLY = PRICE.ultraMonthly;
process.env.STRIPE_PRICE_ULTRA_YEARLY = PRICE.ultraYearly;
process.env.STRIPE_PRICE_PRO_MONTHLY_USD = PRICE.proMonthlyUsd;

type FakeInvoice = { id: string; customer: string; status: string; collection_method: string };

/** A platform subscription with its one item, as Stripe returns it. */
type FakeSubscription = {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  metadata: Record<string, string>;
  discounts: string[];
  /** The schedule attached to it, until released. */
  schedule: string | null;
  items: {
    data: Array<{ id: string; current_period_end: number; price: { id: string; currency: string } }>;
  };
};

/** A subscription schedule, with its phases as Stripe returns them: prices by id. */
type FakeSchedule = {
  id: string;
  subscription: string;
  status: "active" | "released";
  phases: Array<{ start_date: number; end_date: number | null; items: Array<{ price: string }> }>;
};

/** What Stripe's preview of a plan change answers. */
type FakePreview = { total: number; amount_due: number; currency: string };

/** A Checkout Session on the platform account. */
type FakeCheckoutSession = {
  id: string;
  customer: string;
  mode: string;
  status: "open" | "expired";
  metadata: Record<string, string>;
  expires_at?: number;
};

/** Stripe's platform account, in memory: the calls the tested code makes. */
function createFakeStripe() {
  const calls: string[] = [];
  const invoices = new Map<string, FakeInvoice>();
  const subscriptions = new Map<string, FakeSubscription>();
  const checkoutSessions = new Map<string, FakeCheckoutSession>();
  /** Calls that fail, as `calls` writes them. */
  const failing = new Set<string>();
  /** The params of each subscription update, in order. */
  const subscriptionUpdates: Array<{ id: string; params: unknown }> = [];
  /** The subscriptions whose update Stripe refuses, with the error it answers. */
  const refusals = new Map<string, Stripe.errors.StripeError>();
  const schedules = new Map<string, FakeSchedule>();
  /** The params of each schedule update, in order. */
  const scheduleUpdates: Array<{ id: string; params: unknown }> = [];
  /** Stripe's preview of a change, by `<subscription> <price>`; an upgrade's by default. */
  const previews = new Map<string, FakePreview>();
  const invoice = (id: string) => {
    const found = invoices.get(id);
    if (!found) throw new Error(`No such invoice: ${id}`);
    return found;
  };
  const field = (params: unknown, name: string) => String(Reflect.get(Object(params), name));
  const call = (name: string) => {
    calls.push(name);
    if (failing.has(name)) throw new Error(`Stripe is down for ${name}`);
  };
  /** A call written with its ids, which fails when `failing` holds its name alone. */
  const callOn = (name: string, ids: string) => {
    calls.push(`${name} ${ids}`);
    if (failing.has(name)) throw new Error(`Stripe is down for ${name}`);
  };
  const subscription = (id: string) => {
    const found = subscriptions.get(id);
    if (!found) throw new Error(`No such subscription: ${id}`);
    return found;
  };
  return {
    calls,
    failing,
    /** The invoices created, by id. */
    issued: invoices,
    checkoutSessions,
    subscriptionUpdates,
    refusals,
    schedules,
    scheduleUpdates,
    previews,
    /** Leaves a Checkout Session open on the platform account. */
    addCheckoutSession(session: Omit<FakeCheckoutSession, "status">) {
      checkoutSessions.set(session.id, { ...session, status: "open" });
    },
    /** The ids of the open Checkout Sessions, sorted. */
    openCheckoutSessions() {
      return [...checkoutSessions.values()]
        .filter((session) => session.status === "open")
        .map((session) => session.id)
        .sort();
    },
    /** Puts a subscription on the platform account, with one item at `priceId`. */
    addSubscription(id: string, priceId: string, values: Partial<FakeSubscription> = {}) {
      subscriptions.set(id, {
        id,
        customer: `cus_${id.replace(/^sub_/, "")}`,
        status: "active",
        cancel_at_period_end: false,
        metadata: { planSlug: "pro" },
        discounts: [],
        schedule: null,
        items: {
          data: [
            {
              id: `si_${id}`,
              current_period_end: PERIOD_END,
              price: { id: priceId, currency: "eur" },
            },
          ],
        },
        ...values,
      });
    },
    reset() {
      calls.length = 0;
      invoices.clear();
      subscriptions.clear();
      checkoutSessions.clear();
      failing.clear();
      subscriptionUpdates.length = 0;
      refusals.clear();
      schedules.clear();
      scheduleUpdates.length = 0;
      previews.clear();
    },
    /** Attaches a schedule whose next phase bills `nextPrice` from the period's end. */
    attachSchedule(subscriptionId: string, nextPrice: string) {
      const id = `sub_sched_${subscriptionId}`;
      const current = subscription(subscriptionId);
      current.schedule = id;
      schedules.set(id, {
        id,
        subscription: subscriptionId,
        status: "active",
        phases: [
          {
            start_date: PERIOD_START,
            end_date: PERIOD_END,
            items: [{ price: current.items.data[0].price.id }],
          },
          { start_date: PERIOD_END, end_date: null, items: [{ price: nextPrice }] },
        ],
      });
      return id;
    },
    subscriptions: {
      async retrieve(id: string) {
        calls.push(`subscriptions.retrieve ${id}`);
        const found = subscriptions.get(id);
        if (!found) {
          throw new Stripe.errors.StripeInvalidRequestError({
            type: "invalid_request_error",
            code: "resource_missing",
            statusCode: 404,
            message: `No such subscription: '${id}'`,
          });
        }
        return structuredClone(found);
      },
      async update(id: string, params: unknown) {
        calls.push(`subscriptions.update ${id}`);
        subscriptionUpdates.push({ id, params });
        // Stripe's answer when it cannot charge a plan change's difference at once: the
        // subscription stays as it was.
        const refusal = refusals.get(id);
        if (refusal) throw refusal;
        // A schedule manages the cancellation (tested 2026-10-29); a new price would apply
        // at once, with a credit, so the tests refuse it too.
        const held = subscriptions.get(id);
        if (held?.schedule && Reflect.has(Object(params), "cancel_at_period_end")) {
          throw new Stripe.errors.StripeInvalidRequestError({
            type: "invalid_request_error",
            statusCode: 400,
            message: `The subscription is managed by the subscription schedule \`${held.schedule}\``,
          });
        }
        if (held?.schedule) throw new Error(`subscription ${id} changed under schedule ${held.schedule}`);
        return { id };
      },
    },
    subscriptionSchedules: {
      async create(params: { from_subscription: string }) {
        callOn("subscriptionSchedules.create", params.from_subscription);
        const current = subscription(params.from_subscription);
        if (current.schedule) {
          throw new Error(`subscription already attached to schedule ${current.schedule}`);
        }
        const id = `sub_sched_${current.id}`;
        current.schedule = id;
        const created: FakeSchedule = {
          id,
          subscription: current.id,
          status: "active",
          phases: [
            {
              start_date: PERIOD_START,
              end_date: PERIOD_END,
              items: [{ price: current.items.data[0].price.id }],
            },
          ],
        };
        schedules.set(id, created);
        return structuredClone(created);
      },
      async update(id: string, params: unknown) {
        callOn("subscriptionSchedules.update", id);
        scheduleUpdates.push({ id, params });
        const found = schedules.get(id);
        if (!found) throw new Error(`No such schedule: ${id}`);
        return structuredClone(found);
      },
      async release(id: string) {
        callOn("subscriptionSchedules.release", id);
        const found = schedules.get(id);
        if (found?.status !== "active") throw new Error(`schedule ${id} is not active`);
        found.status = "released";
        subscription(found.subscription).schedule = null;
        return structuredClone(found);
      },
      async retrieve(id: string) {
        callOn("subscriptionSchedules.retrieve", id);
        const found = schedules.get(id);
        if (!found) throw new Error(`No such schedule: ${id}`);
        return structuredClone(found);
      },
    },
    checkout: {
      sessions: {
        async create(params: unknown) {
          const items: unknown = Reflect.get(Object(params), "line_items");
          const price = Array.isArray(items) ? field(items[0], "price") : "none";
          const customer = field(params, "customer");
          const first = `cs_${customer}`;
          const id = checkoutSessions.has(first) ? `${first}_${checkoutSessions.size + 1}` : first;
          calls.push(`checkout.sessions.create ${customer} ${price}`);
          const expiresAt: unknown = Reflect.get(Object(params), "expires_at");
          checkoutSessions.set(id, {
            id,
            customer,
            mode: field(params, "mode"),
            status: "open",
            metadata: { storeId: field(Reflect.get(Object(params), "metadata"), "storeId") },
            ...(typeof expiresAt === "number" ? { expires_at: expiresAt } : {}),
          });
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
        async list(params: { customer: string; status: string }) {
          call(`checkout.sessions.list ${params.customer}`);
          const data = [...checkoutSessions.values()].filter(
            (session) => session.customer === params.customer && session.status === params.status,
          );
          return { data: structuredClone(data) };
        },
        async expire(id: string) {
          call(`checkout.sessions.expire ${id}`);
          const found = checkoutSessions.get(id);
          if (found?.status !== "open") throw new Error(`Checkout Session ${id} is not open`);
          found.status = "expired";
          return structuredClone(found);
        },
      },
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
      async createPreview(params: {
        subscription: string;
        subscription_details: { items: Array<{ price: string }> };
      }) {
        const price = params.subscription_details.items[0].price;
        callOn("invoices.createPreview", `${params.subscription} ${price}`);
        return (
          previews.get(`${params.subscription} ${price}`) ?? {
            total: 4900,
            amount_due: 4900,
            currency: "eur",
          }
        );
      },
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
/** The admin notices of a second plan subscription. */
const extraPlanNotices: string[] = [];
/** The stores the early plan sync was asked for, in order; plan-sync-soon.test.ts tests the sync. */
const planSyncs: string[] = [];
/**
 * The store's plan as another connection reads it when the sync is asked for: the new
 * plan once the write has committed, the old one when the call comes before the commit.
 */
const plansAtSync: Array<Promise<unknown>> = [];
const planReader = { read: async (_storeId: string): Promise<unknown> => null };

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
    notifySubscriptionActivated: async () => undefined,
    notifySubscriptionCancelled: async () => undefined,
    notifyExtraPlanSubscription: async (store: { id: string }, kept: string, extra: string) => {
      extraPlanNotices.push(`${store.id} keeps ${kept}, extra ${extra}`);
    },
  },
  "@/lib/billing-sync/plan-sync-soon": {
    syncPlanSoon: (storeId: string) => {
      planSyncs.push(storeId);
      plansAtSync.push(planReader.read(storeId));
    },
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
/** The start and the end of a plan's current period, in Stripe's seconds. */
const PERIOD_START = Date.parse("2026-10-28T10:00:00Z") / 1000;
const PERIOD_END = Date.parse("2026-11-28T10:00:00Z") / 1000;
/** A Pro row, its Stripe ids aside. */
const PLAN_ROW = { billingMode: "subscription", planSlug: "pro", status: "active" } as const;
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
  ["lg_plan_old", OLD],
  ["lg_plan_new", NEW],
  ["lg_plan_buy", NEW],
  ["lg_plan_redo", NEW],
  ["lg_plan_open", NEW],
  ["lg_twice_old", OLD],
  ["lg_twice_new", NEW],
  ["lg_ended_old", OLD],
  ["lg_ended_new", NEW],
  ["lg_admin", OLD],
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
  let webhooks: typeof import("@/lib/stripe/subscription-webhooks");
  const names = [
    "LOUEZ_BILLING",
    "BILLING_SERVICE_URL",
    "BILLING_NEW_STORES_FROM",
    "LOUEZ_MODE",
    "PLATFORM_ADMIN_EMAILS",
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
    webhooks = await import("@/lib/stripe/subscription-webhooks");
    planReader.read = async (storeId) => {
      const row = await planColumns(storeId);
      return [row?.billingMode, row?.planSlug];
    };

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
    const row = (
      storeId: string,
      values: Partial<typeof louezDb.subscriptions.$inferInsert>,
    ) => ({
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
        // On Pro through Louez's Stripe subscription.
        row("lg_plan_old", {
          ...PLAN_ROW,
          stripeSubscriptionId: "sub_lg_plan_old",
          stripeCustomerId: "cus_lg_plan_old",
        }),
        row("lg_plan_new", {
          ...PLAN_ROW,
          stripeSubscriptionId: "sub_lg_plan_new",
          stripeCustomerId: "cus_lg_plan_new",
          payAsYouGoConfig: null,
          pricingVersion: null,
        }),
        row("lg_ended_old", { ...PLAN_ROW, stripeCustomerId: "cus_lg_ended_old" }),
        row("lg_ended_new", {
          ...PLAN_ROW,
          stripeCustomerId: "cus_lg_ended_new",
          payAsYouGoConfig: null,
          pricingVersion: null,
        }),
        row("lg_admin", { ...PLAN_ROW, stripeSubscriptionId: "sub_lg_admin" }),
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
    planSyncs.length = 0;
    plansAtSync.length = 0;
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

  /** The plan columns of a store's row. */
  async function planColumns(storeId: string) {
    return louezDb.db.query.subscriptions.findFirst({
      where: eq(louezDb.subscriptions.storeId, storeId),
      columns: {
        billingMode: true,
        planSlug: true,
        status: true,
        stripeSubscriptionId: true,
        stripeCustomerId: true,
        payAsYouGoConfig: true,
        pricingVersion: true,
        freeReservationsGranted: true,
      },
    });
  }

  async function setPlanRow(
    storeId: string,
    values: Partial<typeof louezDb.subscriptions.$inferInsert>,
  ) {
    await louezDb.db
      .update(louezDb.subscriptions)
      .set(values)
      .where(eq(louezDb.subscriptions.storeId, storeId));
  }

  async function clearMarks(storeId: string) {
    await louezDb.db
      .delete(louezDb.billingSyncQueue)
      .where(eq(louezDb.billingSyncQueue.storeId, storeId));
  }

  /** The aggregate types marked for a store since `clearMarks`. */
  async function marksOf(storeId: string) {
    const rows = await louezDb.db
      .select({ type: louezDb.billingSyncQueue.aggregateType })
      .from(louezDb.billingSyncQueue)
      .where(eq(louezDb.billingSyncQueue.storeId, storeId));
    return rows.map((mark) => mark.type).sort();
  }

  /**
   * A Stripe subscription, as the platform webhook receives it. The handlers read the
   * subscription from Stripe instead, so a test puts Stripe's state in `fakeStripe`.
   */
  const subscriptionEvent = (
    id: string,
    status: Stripe.Subscription.Status,
    priceId: string = PRICE.proMonthly,
  ) => ({
    id,
    status,
    cancel_at_period_end: false,
    metadata: {},
    items: { data: [{ current_period_end: PERIOD_END, price: { id: priceId } }] },
  });

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

  test("a store the service bills buys a plan on its own customer; its card portal is the billing pages", async () => {
    // The pay-as-you-go card portal: the card page, and no Stripe call.
    for (const storeId of ["lg_new", "lg_new_card"]) {
      currentStore.id = storeId;
      assert.deepEqual(await subscriptionActions.openBillingPortal(), { url: PAYMENT_METHOD_LINK });
    }
    assert.deepEqual(fakeStripe.calls, []);

    const checkout = () =>
      subscriptionActions.createCheckoutSession({
        planSlug: "pro",
        interval: "monthly",
        currency: "eur",
      });
    // No customer in the policy or on a row: Louez creates one, kept on a row with no
    // pricing, which nothing bills.
    currentStore.id = "lg_new";
    await clearMarks("lg_new");
    assert.deepEqual(await checkout(), {
      sessionId: "cs_cus_Created_lg_new",
      url: "https://checkout.stripe.test/cs_cus_Created_lg_new",
    });
    assert.deepEqual(fakeStripe.calls, [
      "customers.create cus_Created_lg_new",
      "checkout.sessions.list cus_Created_lg_new",
      `checkout.sessions.create cus_Created_lg_new ${PRICE.proMonthly}`,
    ]);
    assert.deepEqual(await planColumns("lg_new"), {
      billingMode: "pay_as_you_go",
      planSlug: "pay_as_you_go",
      status: "active",
      stripeSubscriptionId: null,
      stripeCustomerId: "cus_Created_lg_new",
      payAsYouGoConfig: null,
      pricingVersion: null,
      freeReservationsGranted: 0,
    });
    assert.deepEqual(await marksOf("lg_new"), ["legacy_store", "store"]);

    // The service's customer when the policy holds one, before the row's.
    fakeStripe.reset();
    currentStore.id = "lg_new_card";
    await checkout();
    assert.deepEqual(fakeStripe.calls, [
      "checkout.sessions.list cus_ServiceNewCard",
      `checkout.sessions.create cus_ServiceNewCard ${PRICE.proMonthly}`,
    ]);

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

  test("a new store's paid checkout puts its plan on its row, and the plan's end takes it off", async () => {
    const { buildStoreSnapshot } = await import("@/lib/billing-sync/snapshots/store-snapshot");
    const planInSnapshot = async () => {
      const built = await buildStoreSnapshot(louezDb.db, {
        type: "store",
        aggregateId: "lg_plan_buy",
        storeId: "lg_plan_buy",
      });
      return built.kind === "snapshot" ? built.data.plan : "no snapshot";
    };
    fakeStripe.addSubscription("sub_lg_plan_buy", PRICE.proMonthly);
    await clearMarks("lg_plan_buy");

    await webhooks.handleSubscriptionCheckoutCompleted({
      metadata: { storeId: "lg_plan_buy", planSlug: "pro" },
      subscription: "sub_lg_plan_buy",
      customer: "cus_lg_plan_buy",
    });
    assert.deepEqual(planSyncs, ["lg_plan_buy"]);
    assert.deepEqual(await Promise.all(plansAtSync), [["subscription", "pro"]]);
    // Stripe delivers it again: the row is written again, and the plan stays as it was.
    await webhooks.handleSubscriptionCheckoutCompleted({
      metadata: { storeId: "lg_plan_buy", planSlug: "pro" },
      subscription: "sub_lg_plan_buy",
      customer: "cus_lg_plan_buy",
    });
    assert.deepEqual(planSyncs, ["lg_plan_buy"]);
    assert.deepEqual(await planColumns("lg_plan_buy"), {
      billingMode: "subscription",
      planSlug: "pro",
      status: "active",
      stripeSubscriptionId: "sub_lg_plan_buy",
      stripeCustomerId: "cus_lg_plan_buy",
      payAsYouGoConfig: null,
      pricingVersion: null,
      freeReservationsGranted: 0,
    });
    assert.deepEqual(await marksOf("lg_plan_buy"), ["legacy_store", "store"]);
    assert.deepEqual(await planInSnapshot(), {
      slug: "pro",
      status: "active",
      stripeCustomerId: "cus_lg_plan_buy",
    });

    // Top-ups still take the policy's customer only: none, so the card page.
    assert.equal(await customers.getPlatformCustomerId("lg_plan_buy"), null);
    const sms = await smsTopup.createSmsTopupCheckoutSession({
      storeId: "lg_plan_buy",
      quantity: 100,
      successUrl: "https://app.test/ok",
      cancelUrl: "https://app.test/cancel",
      translations: { productName: "SMS", productDescription: "SMS" },
    });
    assert.deepEqual(sms, { sessionId: null, url: PAYMENT_METHOD_LINK });

    await clearMarks("lg_plan_buy");
    planSyncs.length = 0;
    plansAtSync.length = 0;
    await webhooks.handleSubscriptionDeleted({ id: "sub_lg_plan_buy", metadata: {} });
    assert.deepEqual(planSyncs, ["lg_plan_buy"]);
    assert.deepEqual(await Promise.all(plansAtSync), [["pay_as_you_go", "pay_as_you_go"]]);
    const ended = await planColumns("lg_plan_buy");
    assert.deepEqual(
      [ended?.billingMode, ended?.planSlug, ended?.stripeSubscriptionId],
      ["pay_as_you_go", "pay_as_you_go", null],
    );
    assert.deepEqual(await marksOf("lg_plan_buy"), ["legacy_store", "store"]);
    assert.equal(await planInSnapshot(), null);
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

  test("a subscription Stripe no longer collects ends a new store's plan, not an old store's", async () => {
    await setPlanRow("lg_plan_new", { ...PLAN_ROW, stripeSubscriptionId: "sub_lg_plan_new" });
    planSyncs.length = 0;
    const statusAfter = async (storeId: string, status: Stripe.Subscription.Status) => {
      fakeStripe.addSubscription(`sub_${storeId}`, PRICE.proMonthly, { status });
      await webhooks.handleSubscriptionUpdated(subscriptionEvent(`sub_${storeId}`, status));
      return (await planColumns(storeId))?.status;
    };
    for (const status of ["unpaid", "incomplete", "paused"] as const) {
      assert.equal(await statusAfter("lg_plan_new", status), "cancelled", status);
      assert.equal(await statusAfter("lg_plan_old", status), "active", status);
    }
    // Only the first one ended a plan: the new store's.
    assert.deepEqual(planSyncs, ["lg_plan_new"]);
    // Stripe's retry window keeps the plan in force, for both: the new store's is back.
    assert.equal(await statusAfter("lg_plan_new", "past_due"), "past_due");
    assert.equal(await statusAfter("lg_plan_old", "past_due"), "past_due");
    assert.deepEqual(planSyncs, ["lg_plan_new", "lg_plan_new"]);

    // A status that keeps the plan in force marks the snapshots, with no early sync.
    await clearMarks("lg_plan_new");
    planSyncs.length = 0;
    assert.equal(await statusAfter("lg_plan_new", "active"), "active");
    assert.deepEqual(await marksOf("lg_plan_new"), ["legacy_store", "store"]);
    assert.deepEqual(planSyncs, []);
  });

  test("a store with a live plan subscription is refused a second Checkout, old or new", async () => {
    for (const storeId of ["lg_plan_old", "lg_plan_new"]) {
      fakeStripe.reset();
      currentStore.id = storeId;
      const checkout = () =>
        subscriptionActions.createCheckoutSession({
          planSlug: "ultra",
          interval: "monthly",
          currency: "eur",
        });
      // Stripe has not ended the subscription, whether it collects it or not.
      for (const [status, stripeStatus] of [
        ["active", "active"],
        ["trialing", "unpaid"],
        ["past_due", "past_due"],
      ] as const) {
        fakeStripe.addSubscription(`sub_${storeId}`, PRICE.proMonthly, { status: stripeStatus });
        await setPlanRow(storeId, { status });
        assert.deepEqual(
          await checkout(),
          { error: "errors.unsupportedOperation", url: null },
          `${storeId} ${status}`,
        );
      }
      assert.deepEqual(fakeStripe.calls, Array(3).fill(`subscriptions.retrieve sub_${storeId}`));
      fakeStripe.calls.length = 0;

      // Once the row's subscription is over, a plan is bought again, on the row's customer.
      await setPlanRow(storeId, { status: "cancelled" });
      assert.deepEqual(await checkout(), {
        sessionId: `cs_cus_${storeId}`,
        url: `https://checkout.stripe.test/cs_cus_${storeId}`,
      });
      assert.deepEqual(fakeStripe.calls, [
        `checkout.sessions.list cus_${storeId}`,
        `checkout.sessions.create cus_${storeId} ${PRICE.ultraMonthly}`,
      ]);
      await setPlanRow(storeId, { status: "active" });
    }
  });

  test("a plan change swaps the price of the store's one subscription, for an old and a new store", async () => {
    for (const storeId of ["lg_plan_old", "lg_plan_new"]) {
      fakeStripe.reset();
      planSyncs.length = 0;
      plansAtSync.length = 0;
      currentStore.id = storeId;
      await setPlanRow(storeId, { status: "active", planSlug: "pro", cancelAtPeriodEnd: true });
      // The owner had scheduled the switch to pay-as-you-go: choosing a plan lifts it.
      fakeStripe.addSubscription(`sub_${storeId}`, PRICE.proMonthly, {
        cancel_at_period_end: true,
        metadata: { planSlug: "pro", pendingBillingMode: "pay_as_you_go" },
      });

      assert.deepEqual(
        await subscriptionActions.changeSubscriptionPlan({
          planSlug: "ultra",
          interval: "monthly",
          currency: "eur",
        }),
        { success: true },
        storeId,
      );
      // Stripe previews the change first: an upgrade costs something, so it applies now.
      assert.deepEqual(fakeStripe.calls, [
        `subscriptions.retrieve sub_${storeId}`,
        `invoices.createPreview sub_${storeId} ${PRICE.ultraMonthly}`,
        `subscriptions.update sub_${storeId}`,
      ]);
      assert.deepEqual(fakeStripe.subscriptionUpdates, [
        {
          id: `sub_${storeId}`,
          params: {
            items: [{ id: `si_sub_${storeId}`, price: PRICE.ultraMonthly }],
            proration_behavior: "always_invoice",
            payment_behavior: "error_if_incomplete",
            cancel_at_period_end: false,
            metadata: { planSlug: "ultra", pendingBillingMode: "" },
          },
        },
      ]);
      const row = await planColumns(storeId);
      assert.deepEqual(
        { planSlug: row?.planSlug, stripeSubscriptionId: row?.stripeSubscriptionId },
        { planSlug: "ultra", stripeSubscriptionId: `sub_${storeId}` },
      );
      assert.deepEqual(planSyncs, [storeId]);
      assert.deepEqual(await Promise.all(plansAtSync), [["subscription", "ultra"]]);
    }

    // Another interval of the same plan, or a cancellation lifted on it, changes Stripe
    // and the row but not the plan in force: no early sync.
    for (const [price, interval, cancelAtPeriodEnd] of [
      [PRICE.ultraMonthly, "yearly", false],
      [PRICE.ultraYearly, "yearly", true],
    ] as const) {
      fakeStripe.reset();
      planSyncs.length = 0;
      await setPlanRow("lg_plan_new", { cancelAtPeriodEnd });
      fakeStripe.addSubscription("sub_lg_plan_new", price, {
        cancel_at_period_end: cancelAtPeriodEnd,
      });
      assert.deepEqual(
        await subscriptionActions.changeSubscriptionPlan({
          planSlug: "ultra",
          interval,
          currency: "eur",
        }),
        { success: true },
        `${price} ${interval}`,
      );
      assert.equal(fakeStripe.subscriptionUpdates.length, 1, `${price} ${interval}`);
      assert.equal((await planColumns("lg_plan_new"))?.planSlug, "ultra");
      assert.deepEqual(planSyncs, [], `${price} ${interval}`);
    }

    // Another currency than the subscription's, which Stripe cannot change, or no live
    // subscription: refused, and Stripe is not changed.
    fakeStripe.reset();
    planSyncs.length = 0;
    fakeStripe.addSubscription("sub_lg_plan_new", PRICE.ultraMonthly);
    const change = (currency: "eur" | "usd") =>
      subscriptionActions.changeSubscriptionPlan({ planSlug: "pro", interval: "monthly", currency });
    assert.deepEqual(await change("usd"), { error: "errors.unsupportedOperation" });
    await setPlanRow("lg_plan_new", { status: "cancelled" });
    assert.deepEqual(await change("eur"), { error: "errors.unsupportedOperation" });
    assert.deepEqual(fakeStripe.subscriptionUpdates, []);
    assert.deepEqual(planSyncs, []);
    await setPlanRow("lg_plan_new", { status: "active" });
  });

  test("a plan change Stripe cannot charge at once leaves the subscription and the row as they were", async () => {
    const cardError = (code: string, declineCode?: string) =>
      new Stripe.errors.StripeCardError({
        type: "card_error",
        code,
        decline_code: declineCode,
        statusCode: 402,
        message: "Your card was declined.",
      });
    const refusals = [
      { case: "declined", error: cardError("card_declined"), reason: "payment_failed" },
      // A bank that asks for 3D Secure, which an update cannot pass.
      {
        case: "3D Secure",
        error: cardError("subscription_payment_intent_requires_action"),
        reason: "payment_confirmation_required",
      },
      {
        case: "authentication declined",
        error: cardError("card_declined", "authentication_required"),
        reason: "payment_confirmation_required",
      },
      // A customer with no card, such as a store whose trial Checkout collected none.
      {
        case: "no card",
        error: new Stripe.errors.StripeInvalidRequestError({
          type: "invalid_request_error",
          code: "resource_missing",
          statusCode: 400,
          message: "This customer has no attached payment source or default payment method.",
        }),
        reason: "no_payment_method",
      },
    ];
    const actionErrors: Record<string, string> = {
      payment_failed: "errors.planPaymentFailed",
      payment_confirmation_required: "errors.planPaymentConfirmationRequired",
      no_payment_method: "errors.planNoPaymentMethod",
    };
    for (const refusal of refusals) {
      for (const storeId of ["lg_plan_old", "lg_plan_new"]) {
        const label = `${storeId} ${refusal.case}`;
        fakeStripe.reset();
        currentStore.id = storeId;
        await setPlanRow(storeId, { status: "active", planSlug: "pro", cancelAtPeriodEnd: true });
        fakeStripe.addSubscription(`sub_${storeId}`, PRICE.proMonthly, { cancel_at_period_end: true });
        fakeStripe.refusals.set(`sub_${storeId}`, refusal.error);
        const rowBefore = await louezDb.db.query.subscriptions.findFirst({
          where: eq(louezDb.subscriptions.storeId, storeId),
        });
        await clearMarks(storeId);

        await assert.rejects(
          customers.changeSubscriptionPlan(storeId, "ultra", "monthly", "eur"),
          (error) =>
            error instanceof customers.SubscriptionPlanError && error.reason === refusal.reason,
          label,
        );
        assert.deepEqual(
          await subscriptionActions.changeSubscriptionPlan({
            planSlug: "ultra",
            interval: "monthly",
            currency: "eur",
          }),
          { error: actionErrors[refusal.reason] },
          label,
        );
        assert.deepEqual(
          fakeStripe.subscriptionUpdates.map((update) => update.id),
          [`sub_${storeId}`, `sub_${storeId}`],
        );
        assert.deepEqual(
          await louezDb.db.query.subscriptions.findFirst({
            where: eq(louezDb.subscriptions.storeId, storeId),
          }),
          rowBefore,
          label,
        );
        assert.deepEqual(await marksOf(storeId), [], label);
      }
    }
    for (const storeId of ["lg_plan_old", "lg_plan_new"]) {
      await setPlanRow(storeId, { cancelAtPeriodEnd: false });
    }
  });

  test("a missing object Stripe names is not a missing card: the change fails as any error", async () => {
    const storeId = "lg_plan_new";
    fakeStripe.reset();
    currentStore.id = storeId;
    await setPlanRow(storeId, { status: "active", planSlug: "pro" });
    fakeStripe.addSubscription(`sub_${storeId}`, PRICE.proMonthly);
    const missingPrice = new Stripe.errors.StripeInvalidRequestError({
      type: "invalid_request_error",
      code: "resource_missing",
      param: "items[0][price]",
      statusCode: 400,
      message: `No such price: '${PRICE.ultraMonthly}'`,
    });
    fakeStripe.refusals.set(`sub_${storeId}`, missingPrice);

    await assert.rejects(
      customers.changeSubscriptionPlan(storeId, "ultra", "monthly", "eur"),
      (error) => error === missingPrice,
    );
    assert.deepEqual(
      await subscriptionActions.changeSubscriptionPlan({
        planSlug: "ultra",
        interval: "monthly",
        currency: "eur",
      }),
      { error: "errors.generic" },
    );
    const row = await louezDb.db.query.subscriptions.findFirst({
      where: eq(louezDb.subscriptions.storeId, storeId),
      columns: { planSlug: true },
    });
    assert.equal(row?.planSlug, "pro");
  });

  test("a plan change that costs something, or nothing, applies at once; one that would leave a credit starts at the end of the paid period", async () => {
    for (const storeId of ["lg_plan_old", "lg_plan_new"]) {
      const subscription = `sub_${storeId}`;
      currentStore.id = storeId;

      // Nothing to pay, as during a trial: at once, as an upgrade.
      fakeStripe.reset();
      planSyncs.length = 0;
      await setPlanRow(storeId, { status: "active", planSlug: "ultra", cancelAtPeriodEnd: false });
      fakeStripe.addSubscription(subscription, PRICE.ultraMonthly);
      fakeStripe.previews.set(`${subscription} ${PRICE.proMonthly}`, {
        total: 0,
        amount_due: 0,
        currency: "eur",
      });
      assert.deepEqual(await customers.changeSubscriptionPlan(storeId, "pro", "monthly", "eur"), {
        kind: "in_place",
      });
      assert.deepEqual(fakeStripe.calls, [
        `subscriptions.retrieve ${subscription}`,
        `invoices.createPreview ${subscription} ${PRICE.proMonthly}`,
        `subscriptions.update ${subscription}`,
      ]);
      assert.equal((await planColumns(storeId))?.planSlug, "pro", storeId);
      assert.deepEqual(planSyncs, [storeId]);

      // A credit, Ultra monthly to Pro monthly: a schedule, and the store keeps Ultra. The
      // cancellation the owner had scheduled is lifted first, before any schedule exists.
      for (const cancelAtPeriodEnd of [false, true]) {
        const label = `${storeId} cancelAtPeriodEnd=${cancelAtPeriodEnd}`;
        fakeStripe.reset();
        planSyncs.length = 0;
        await setPlanRow(storeId, { status: "active", planSlug: "ultra", cancelAtPeriodEnd });
        fakeStripe.addSubscription(subscription, PRICE.ultraMonthly, {
          cancel_at_period_end: cancelAtPeriodEnd,
          discounts: ["di_store_coupon"],
          metadata: { planSlug: "ultra", pendingBillingMode: "pay_as_you_go" },
        });
        fakeStripe.previews.set(`${subscription} ${PRICE.proMonthly}`, {
          total: -11000,
          amount_due: 0,
          currency: "eur",
        });
        await clearMarks(storeId);

        assert.deepEqual(
          await customers.changeSubscriptionPlan(storeId, "pro", "monthly", "eur"),
          { kind: "scheduled", planSlug: "pro", at: new Date(PERIOD_END * 1000) },
          label,
        );
        assert.deepEqual(
          fakeStripe.calls,
          [
            `subscriptions.retrieve ${subscription}`,
            `invoices.createPreview ${subscription} ${PRICE.proMonthly}`,
            ...(cancelAtPeriodEnd ? [`subscriptions.update ${subscription}`] : []),
            `subscriptionSchedules.create ${subscription}`,
            `subscriptionSchedules.update sub_sched_${subscription}`,
          ],
          label,
        );
        assert.deepEqual(
          fakeStripe.subscriptionUpdates,
          cancelAtPeriodEnd
            ? [
                {
                  id: subscription,
                  params: { cancel_at_period_end: false, metadata: { pendingBillingMode: "" } },
                },
              ]
            : [],
          label,
        );
        // The phases name the subscription's discount, or Stripe drops its coupon.
        assert.deepEqual(
          fakeStripe.scheduleUpdates,
          [
            {
              id: `sub_sched_${subscription}`,
              params: {
                end_behavior: "release",
                proration_behavior: "none",
                phases: [
                  {
                    items: [{ price: PRICE.ultraMonthly, quantity: 1 }],
                    start_date: PERIOD_START,
                    end_date: PERIOD_END,
                    discounts: [{ discount: "di_store_coupon" }],
                  },
                  {
                    items: [{ price: PRICE.proMonthly, quantity: 1 }],
                    duration: { interval: "month", interval_count: 1 },
                    discounts: [{ discount: "di_store_coupon" }],
                    metadata: { planSlug: "pro" },
                  },
                ],
              },
            },
          ],
          label,
        );
        const row = await louezDb.db.query.subscriptions.findFirst({
          where: eq(louezDb.subscriptions.storeId, storeId),
          columns: { planSlug: true, cancelAtPeriodEnd: true },
        });
        assert.deepEqual(row, { planSlug: "ultra", cancelAtPeriodEnd: false }, label);
        assert.deepEqual(await marksOf(storeId), cancelAtPeriodEnd ? ["legacy_store", "store"] : [], label);
        assert.deepEqual(planSyncs, [], label);
      }

      // At the period end Stripe bills the new price: the webhook writes it, and the plan
      // in force changes then.
      fakeStripe.addSubscription(subscription, PRICE.proMonthly);
      await webhooks.handleSubscriptionUpdated(subscriptionEvent(subscription, "active"));
      assert.equal((await planColumns(storeId))?.planSlug, "pro", storeId);
      assert.deepEqual(planSyncs, [storeId]);
    }

    // A yearly plan's next phase lasts a year.
    fakeStripe.reset();
    currentStore.id = "lg_plan_new";
    fakeStripe.addSubscription("sub_lg_plan_new", PRICE.ultraYearly);
    fakeStripe.previews.set(`sub_lg_plan_new ${PRICE.proYearly}`, {
      total: -40000,
      amount_due: 0,
      currency: "eur",
    });
    assert.deepEqual(
      await subscriptionActions.changeSubscriptionPlan({
        planSlug: "pro",
        interval: "yearly",
        currency: "eur",
      }),
      { success: true },
    );
    const phases: unknown = Reflect.get(Object(fakeStripe.scheduleUpdates[0]?.params), "phases");
    assert.deepEqual(Reflect.get(Object(Array.isArray(phases) ? phases[1] : null), "duration"), {
      interval: "year",
      interval_count: 1,
    });
    await setPlanRow("lg_plan_new", { planSlug: "pro" });
  });

  test("a pending plan change is released before any other update of the subscription, and the price the store pays keeps it", async () => {
    const storeId = "lg_plan_new";
    const subscription = "sub_lg_plan_new";
    const schedule = `sub_sched_${subscription}`;
    currentStore.id = storeId;
    /** Ultra monthly, with Pro monthly waiting for the end of the paid period. */
    const pending = async () => {
      fakeStripe.reset();
      await setPlanRow(storeId, { status: "active", planSlug: "ultra", cancelAtPeriodEnd: false });
      fakeStripe.addSubscription(subscription, PRICE.ultraMonthly);
      fakeStripe.attachSchedule(subscription, PRICE.proMonthly);
    };
    const released = (...after: string[]) => [
      `subscriptions.retrieve ${subscription}`,
      `subscriptionSchedules.release ${schedule}`,
      ...after,
    ];

    // A cancellation, which Stripe refuses while the schedule is attached.
    await pending();
    assert.deepEqual(await subscriptionActions.cancelSubscription(), { success: true });
    assert.deepEqual(fakeStripe.calls, released(`subscriptions.update ${subscription}`));
    assert.deepEqual(fakeStripe.subscriptionUpdates, [
      { id: subscription, params: { cancel_at_period_end: true } },
    ]);

    // The switch to pay-as-you-go at the period end.
    await pending();
    const switched = await subscriptionActions.switchToPayAsYouGo();
    assert.equal(Reflect.get(switched, "mode"), "deferred");
    assert.deepEqual(fakeStripe.calls, released(`subscriptions.update ${subscription}`));

    // Lifting a cancellation also works with nothing attached.
    await pending();
    assert.deepEqual(await subscriptionActions.reactivateSubscription(), { success: true });
    assert.deepEqual(fakeStripe.calls, released(`subscriptions.update ${subscription}`));
    fakeStripe.calls.length = 0;
    assert.deepEqual(await subscriptionActions.reactivateSubscription(), { success: true });
    assert.deepEqual(fakeStripe.calls, [
      `subscriptions.retrieve ${subscription}`,
      `subscriptions.update ${subscription}`,
    ]);

    // Another change that costs something: previewed while the schedule holds, then
    // applied once it is released.
    await pending();
    assert.deepEqual(await customers.changeSubscriptionPlan(storeId, "ultra", "yearly", "eur"), {
      kind: "in_place",
    });
    assert.deepEqual(fakeStripe.calls, [
      `subscriptions.retrieve ${subscription}`,
      `invoices.createPreview ${subscription} ${PRICE.ultraYearly}`,
      `subscriptionSchedules.release ${schedule}`,
      `subscriptions.update ${subscription}`,
    ]);

    // Another change that would leave a credit replaces the pending one.
    await pending();
    fakeStripe.previews.set(`${subscription} ${PRICE.proYearly}`, {
      total: -1000,
      amount_due: 0,
      currency: "eur",
    });
    assert.equal(
      (await customers.changeSubscriptionPlan(storeId, "pro", "yearly", "eur")).kind,
      "scheduled",
    );
    assert.deepEqual(fakeStripe.calls, [
      `subscriptions.retrieve ${subscription}`,
      `invoices.createPreview ${subscription} ${PRICE.proYearly}`,
      `subscriptionSchedules.release ${schedule}`,
      `subscriptionSchedules.create ${subscription}`,
      `subscriptionSchedules.update ${schedule}`,
    ]);

    // A preview Stripe cannot answer keeps the pending change.
    await pending();
    fakeStripe.failing.add("invoices.createPreview");
    assert.deepEqual(
      await subscriptionActions.changeSubscriptionPlan({
        planSlug: "ultra",
        interval: "yearly",
        currency: "eur",
      }),
      { error: "errors.generic" },
    );
    assert.equal(fakeStripe.schedules.get(schedule)?.status, "active");

    // The price the store pays: the pending change is dropped, nothing else changes.
    await pending();
    assert.deepEqual(await customers.changeSubscriptionPlan(storeId, "ultra", "monthly", "eur"), {
      kind: "kept",
    });
    assert.deepEqual(fakeStripe.calls, released());
    assert.deepEqual(fakeStripe.subscriptionUpdates, []);

    // The page's button to keep the plan.
    await pending();
    assert.deepEqual(await subscriptionActions.keepCurrentPlan(), { success: true });
    assert.deepEqual(fakeStripe.calls, released());
    assert.equal((await planColumns(storeId))?.planSlug, "ultra");
    await setPlanRow(storeId, { planSlug: "pro", cancelAtPeriodEnd: false });
  });

  test("the change dialog's preview says what Stripe charges now, or the day the new plan starts, and changes nothing", async () => {
    const subscription = "sub_lg_plan_old";
    currentStore.id = "lg_plan_old";
    await setPlanRow("lg_plan_old", { status: "active", planSlug: "pro", cancelAtPeriodEnd: false });
    const preview = () =>
      subscriptionActions.previewPlanChange({ planSlug: "ultra", interval: "monthly", currency: "eur" });

    fakeStripe.reset();
    fakeStripe.addSubscription(subscription, PRICE.proMonthly);
    fakeStripe.previews.set(`${subscription} ${PRICE.ultraMonthly}`, {
      total: 11000,
      amount_due: 11000,
      currency: "eur",
    });
    assert.deepEqual(await preview(), { kind: "now", amountDue: 11000, currency: "eur" });

    fakeStripe.previews.set(`${subscription} ${PRICE.ultraMonthly}`, {
      total: -11000,
      amount_due: 0,
      currency: "eur",
    });
    assert.deepEqual(await preview(), {
      kind: "at_period_end",
      at: new Date(PERIOD_END * 1000),
    });

    // With a change pending, the preview leaves its schedule alone.
    fakeStripe.attachSchedule(subscription, PRICE.proYearly);
    fakeStripe.failing.add("invoices.createPreview");
    assert.deepEqual(await preview(), { error: "errors.generic" });
    assert.deepEqual(fakeStripe.subscriptionUpdates, []);
    assert.deepEqual(fakeStripe.scheduleUpdates, []);
    assert.ok(!fakeStripe.calls.some((name) => name.startsWith("subscriptionSchedules.")));
  });

  test("the plan page reads the pending plan change from the subscription's schedule, and only hides it when Stripe cannot say", async () => {
    const subscription = "sub_lg_plan_new";
    fakeStripe.reset();
    await setPlanRow("lg_plan_new", { status: "active", planSlug: "pro", cancelAtPeriodEnd: false });
    fakeStripe.addSubscription(subscription, PRICE.proMonthly);
    const read = async () => {
      const page = await customers.getSubscriptionWithPlan("lg_plan_new");
      return { pendingPlanChange: page?.pendingPlanChange, currency: page?.billingCurrency };
    };

    assert.deepEqual(await read(), { pendingPlanChange: null, currency: "eur" });
    fakeStripe.attachSchedule(subscription, PRICE.ultraYearly);
    assert.deepEqual(await read(), {
      pendingPlanChange: { planSlug: "ultra", interval: "yearly", at: new Date(PERIOD_END * 1000) },
      currency: "eur",
    });
    fakeStripe.failing.add("subscriptionSchedules.retrieve");
    assert.deepEqual(await read(), { pendingPlanChange: null, currency: "eur" });
  });

  test("an update writes the plan its price bills, for an old and a new store", async () => {
    for (const storeId of ["lg_plan_old", "lg_plan_new"]) {
      const updated = async (priceId: string) => {
        fakeStripe.addSubscription(`sub_${storeId}`, priceId);
        await webhooks.handleSubscriptionUpdated(
          subscriptionEvent(`sub_${storeId}`, "active", priceId),
        );
        return (await planColumns(storeId))?.planSlug;
      };
      await setPlanRow(storeId, { planSlug: "pro" });
      await clearMarks(storeId);
      assert.equal(await updated(PRICE.ultraMonthly), "ultra", storeId);
      assert.deepEqual(await marksOf(storeId), ["legacy_store", "store"]);
      assert.equal(await updated(PRICE.proYearly), "pro", storeId);
      // A price no plan has leaves the plan as it is.
      assert.equal(await updated("price_test_unknown"), "pro", storeId);
    }
  });

  test("a late or redelivered update writes what Stripe bills now, not what the event carried", async () => {
    const rowOf = (storeId: string) =>
      louezDb.db.query.subscriptions.findFirst({
        where: eq(louezDb.subscriptions.storeId, storeId),
        columns: { planSlug: true, status: true, cancelAtPeriodEnd: true, currentPeriodEnd: true },
      });
    const NEXT_PERIOD_END = PERIOD_END + 30 * 24 * 3600;
    for (const storeId of ["lg_plan_old", "lg_plan_new"]) {
      fakeStripe.reset();
      await setPlanRow(storeId, { planSlug: "ultra", status: "active", cancelAtPeriodEnd: false });
      // Stripe bills Ultra now, in a later period, with the end the owner scheduled. The
      // event comes from the Pro days, when a payment had failed.
      fakeStripe.addSubscription(`sub_${storeId}`, PRICE.ultraMonthly, {
        cancel_at_period_end: true,
        items: {
          data: [
            {
              id: `si_sub_${storeId}`,
              current_period_end: NEXT_PERIOD_END,
              price: { id: PRICE.ultraMonthly, currency: "eur" },
            },
          ],
        },
      });
      await webhooks.handleSubscriptionUpdated(
        subscriptionEvent(`sub_${storeId}`, "unpaid", PRICE.proMonthly),
      );
      assert.deepEqual(
        await rowOf(storeId),
        {
          planSlug: "ultra",
          status: "active",
          cancelAtPeriodEnd: true,
          currentPeriodEnd: new Date(NEXT_PERIOD_END * 1000),
        },
        storeId,
      );
      assert.deepEqual(fakeStripe.calls, [`subscriptions.retrieve sub_${storeId}`]);
      await setPlanRow(storeId, { planSlug: "pro", status: "active", cancelAtPeriodEnd: false });
    }
  });

  test("a redelivered plan checkout writes the plan Stripe bills, and nothing once its subscription ended", async () => {
    const checkout = (subscription: string) =>
      webhooks.handleSubscriptionCheckoutCompleted({
        metadata: { storeId: "lg_plan_redo", planSlug: "pro" },
        subscription,
        customer: "cus_lg_plan_redo",
      });
    const planOf = async () => {
      const row = await planColumns("lg_plan_redo");
      return [row?.billingMode, row?.planSlug, row?.status, row?.stripeSubscriptionId];
    };

    // A price no plan has: the plan the session sold.
    fakeStripe.addSubscription("sub_lg_plan_redo", "price_test_unknown");
    await checkout("sub_lg_plan_redo");
    assert.deepEqual(await planOf(), ["subscription", "pro", "active", "sub_lg_plan_redo"]);

    // Moved to Ultra in place, then the session that sold Pro comes again.
    fakeStripe.addSubscription("sub_lg_plan_redo", PRICE.ultraMonthly);
    await checkout("sub_lg_plan_redo");
    assert.deepEqual(await planOf(), ["subscription", "ultra", "active", "sub_lg_plan_redo"]);

    // The subscription ends and the store buys Pro again. The first session, delivered
    // once more, leaves the new subscription on the row.
    await webhooks.handleSubscriptionDeleted({ id: "sub_lg_plan_redo", metadata: {} });
    fakeStripe.addSubscription("sub_lg_plan_redo", PRICE.ultraMonthly, { status: "canceled" });
    fakeStripe.addSubscription("sub_lg_plan_redo_next", PRICE.proMonthly);
    await checkout("sub_lg_plan_redo_next");
    assert.deepEqual(await planOf(), ["subscription", "pro", "active", "sub_lg_plan_redo_next"]);
    await clearMarks("lg_plan_redo");
    planSyncs.length = 0;
    await checkout("sub_lg_plan_redo");
    assert.deepEqual(await planOf(), ["subscription", "pro", "active", "sub_lg_plan_redo_next"]);
    assert.deepEqual(await marksOf("lg_plan_redo"), []);
    assert.deepEqual(planSyncs, []);
  });

  test("a plan Checkout first expires the store's other open plan Checkouts, and is payable for 31 minutes", async () => {
    currentStore.id = "lg_plan_open";
    const customer = "cus_Created_lg_plan_open";
    const checkout = async () => {
      const opened = await subscriptionActions.createCheckoutSession({
        planSlug: "pro",
        interval: "monthly",
        currency: "eur",
      });
      assert.ok("sessionId" in opened, "a Checkout is opened");
      return opened.sessionId;
    };
    const expired = () => fakeStripe.calls.filter((call) => call.startsWith("checkout.sessions.expire"));
    // Also open on the customer: a top-up, and a plan Checkout another store made.
    fakeStripe.addCheckoutSession({
      id: "cs_topup",
      customer,
      mode: "payment",
      metadata: { storeId: "lg_plan_open" },
    });
    fakeStripe.addCheckoutSession({
      id: "cs_other_store",
      customer,
      mode: "subscription",
      metadata: { storeId: "lg_other" },
    });

    const before = Math.floor(Date.now() / 1000);
    const first = await checkout();
    const second = await checkout();
    const third = await checkout();
    const after = Math.floor(Date.now() / 1000);
    assert.deepEqual(expired(), [
      `checkout.sessions.expire ${first}`,
      `checkout.sessions.expire ${second}`,
    ]);
    assert.deepEqual(fakeStripe.openCheckoutSessions(), ["cs_other_store", "cs_topup", third].sort());
    for (const id of [first, second, third]) {
      const expiresAt = fakeStripe.checkoutSessions.get(id)?.expires_at ?? 0;
      assert.ok(expiresAt >= before + 31 * 60 && expiresAt <= after + 31 * 60, `${id} ${expiresAt}`);
    }

    // Stripe fails to list them: the new Checkout opens all the same.
    fakeStripe.calls.length = 0;
    fakeStripe.failing.add(`checkout.sessions.list ${customer}`);
    const fourth = await checkout();
    assert.deepEqual(expired(), []);
    fakeStripe.failing.clear();

    // Stripe fails to expire one of them: the others are expired, and the new one opens.
    fakeStripe.calls.length = 0;
    fakeStripe.failing.add(`checkout.sessions.expire ${third}`);
    const fifth = await checkout();
    assert.deepEqual(expired(), [
      `checkout.sessions.expire ${third}`,
      `checkout.sessions.expire ${fourth}`,
    ]);
    assert.deepEqual(
      fakeStripe.openCheckoutSessions(),
      ["cs_other_store", "cs_topup", third, fifth].sort(),
    );
  });

  test("a second plan subscription, paid through another open Checkout, leaves the row alone and tells staff, for an old and a new store", async () => {
    for (const storeId of ["lg_twice_old", "lg_twice_new"]) {
      const first = `sub_${storeId}_1`;
      const second = `sub_${storeId}_2`;
      const completed = (subscription: string) =>
        webhooks.handleSubscriptionCheckoutCompleted({
          metadata: { storeId, planSlug: "pro" },
          subscription,
          customer: `cus_${storeId}`,
        });
      const held = async () => {
        const row = await planColumns(storeId);
        return [row?.billingMode, row?.planSlug, row?.stripeSubscriptionId];
      };
      fakeStripe.addSubscription(first, PRICE.proMonthly);
      fakeStripe.addSubscription(second, PRICE.ultraMonthly);
      await completed(first);
      assert.deepEqual(await held(), ["subscription", "pro", first], storeId);

      // Both Checkouts were open; the second is paid while Stripe bills the first.
      await clearMarks(storeId);
      extraPlanNotices.length = 0;
      planSyncs.length = 0;
      await completed(second);
      assert.deepEqual(await held(), ["subscription", "pro", first], storeId);
      assert.deepEqual(await marksOf(storeId), [], storeId);
      assert.deepEqual(planSyncs, [], storeId);
      assert.deepEqual(extraPlanNotices, [`${storeId} keeps ${first}, extra ${second}`]);

      // Once Stripe has ended the first one, whose deletion the webhook missed, the paid
      // one is the store's plan.
      extraPlanNotices.length = 0;
      fakeStripe.addSubscription(first, PRICE.proMonthly, { status: "canceled" });
      await completed(second);
      assert.deepEqual(await held(), ["subscription", "ultra", second], storeId);
      assert.deepEqual(await marksOf(storeId), ["legacy_store", "store"], storeId);

      // Nor does one Stripe no longer has.
      await setPlanRow(storeId, { stripeSubscriptionId: `sub_${storeId}_gone` });
      await completed(second);
      assert.deepEqual(await held(), ["subscription", "ultra", second], storeId);
      assert.deepEqual(extraPlanNotices, [], storeId);
    }

    // Stripe stops collecting the plan (unpaid): it no longer holds a new store's plan
    // (rowStatus), and still holds an old store's.
    for (const [storeId, kept] of [
      ["lg_twice_old", true],
      ["lg_twice_new", false],
    ] as const) {
      const third = `sub_${storeId}_3`;
      fakeStripe.addSubscription(`sub_${storeId}_2`, PRICE.ultraMonthly, { status: "unpaid" });
      fakeStripe.addSubscription(third, PRICE.proMonthly);
      extraPlanNotices.length = 0;
      await webhooks.handleSubscriptionCheckoutCompleted({
        metadata: { storeId, planSlug: "pro" },
        subscription: third,
        customer: `cus_${storeId}`,
      });
      const row = await planColumns(storeId);
      assert.equal(row?.stripeSubscriptionId, kept ? `sub_${storeId}_2` : third, storeId);
      assert.equal(extraPlanNotices.length, kept ? 1 : 0, storeId);
    }
  });

  test("a row whose subscription Stripe has ended goes back to pay-as-you-go, and the plan is bought through Checkout, from both entry points, for an old and a new store", async () => {
    const plan = { planSlug: "ultra", interval: "monthly", currency: "eur" } as const;
    const entryPoints = {
      checkout: () => subscriptionActions.createCheckoutSession(plan),
      change: () => subscriptionActions.changeSubscriptionPlan(plan),
    };
    // The webhook missed `.deleted`: Stripe has ended the subscription, or no longer has it.
    const endings = {
      canceled: (id: string) =>
        fakeStripe.addSubscription(id, PRICE.proMonthly, { status: "canceled" }),
      incomplete_expired: (id: string) =>
        fakeStripe.addSubscription(id, PRICE.proMonthly, { status: "incomplete_expired" }),
      gone: () => undefined,
    };
    for (const storeId of ["lg_ended_old", "lg_ended_new"]) {
      currentStore.id = storeId;
      const subscription = `sub_${storeId}`;
      const customer = `cus_${storeId}`;
      for (const [entry, open] of Object.entries(entryPoints)) {
        for (const [ending, end] of Object.entries(endings)) {
          const label = `${storeId} ${entry} ${ending}`;
          fakeStripe.reset();
          planSyncs.length = 0;
          plansAtSync.length = 0;
          end(subscription);
          await setPlanRow(storeId, { ...PLAN_ROW, stripeSubscriptionId: subscription });
          await clearMarks(storeId);

          const answer = await open();
          assert.equal(
            Reflect.get(answer, "url"),
            `https://checkout.stripe.test/cs_${customer}`,
            label,
          );
          assert.deepEqual(
            fakeStripe.calls,
            [
              `subscriptions.retrieve ${subscription}`,
              `checkout.sessions.list ${customer}`,
              `checkout.sessions.create ${customer} ${PRICE.ultraMonthly}`,
            ],
            label,
          );
          assert.deepEqual(fakeStripe.subscriptionUpdates, [], label);
          // As `.deleted` writes it: pay-as-you-go at the pricing the row holds, both marks.
          const row = await planColumns(storeId);
          assert.deepEqual(
            {
              billingMode: row?.billingMode,
              planSlug: row?.planSlug,
              status: row?.status,
              stripeSubscriptionId: row?.stripeSubscriptionId,
              stripeCustomerId: row?.stripeCustomerId,
              payAsYouGoConfig: row?.payAsYouGoConfig,
            },
            {
              billingMode: "pay_as_you_go",
              planSlug: "pay_as_you_go",
              status: "active",
              stripeSubscriptionId: null,
              stripeCustomerId: customer,
              payAsYouGoConfig: storeId === "lg_ended_old" ? { flatRateCents: 123 } : null,
            },
            label,
          );
          assert.deepEqual(await marksOf(storeId), ["legacy_store", "store"], label);
          assert.deepEqual(planSyncs, [storeId], label);
          assert.deepEqual(
            await Promise.all(plansAtSync),
            [["pay_as_you_go", "pay_as_you_go"]],
            label,
          );
        }
      }
    }
  });

  test("a platform admin's billing mode change that ends the plan asks for the early plan sync; other settings do not", async () => {
    const admin = await import("@/app/(dashboard)/dashboard/settings/admin/actions");
    session.userId = "lg_admin_user";
    process.env.PLATFORM_ADMIN_EMAILS = "lg_admin_user@louez.test";
    currentStore.id = "lg_admin";
    const loaded: AdminSettingsInput["loaded"] = {
      billingMode: "subscription",
      payAsYouGoConfig: { flatRateCents: 123, tiers: [], currency: "eur" },
      freeReservationsGranted: 0,
    };
    const save = (values: Partial<AdminSettingsInput["loaded"]>) =>
      admin.updateAdminSettings({
        trialDays: 0,
        discountPercent: 0,
        discountDurationMonths: 0,
        ...loaded,
        ...values,
        loaded,
      });

    assert.deepEqual(await save({ billingMode: "pay_as_you_go" }), { success: true });
    assert.equal((await planColumns("lg_admin"))?.billingMode, "pay_as_you_go");
    assert.deepEqual(planSyncs, ["lg_admin"]);

    planSyncs.length = 0;
    await setPlanRow("lg_admin", { billingMode: "subscription" });
    assert.deepEqual(await save({ freeReservationsGranted: 5 }), { success: true });
    assert.equal((await planColumns("lg_admin"))?.freeReservationsGranted, 5);
    assert.deepEqual(planSyncs, []);

    // Without a Stripe subscription, no plan is in force in either billing mode.
    await setPlanRow("lg_admin", { stripeSubscriptionId: null });
    assert.deepEqual(await save({ billingMode: "pay_as_you_go" }), { success: true });
    assert.equal((await planColumns("lg_admin"))?.billingMode, "pay_as_you_go");
    assert.deepEqual(planSyncs, []);
  });
});
