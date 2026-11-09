import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type {
  StripeAccountCreateParams,
  StripeAccountLike,
  StripeConnectClient,
} from "../../adapters/stripe-connect";
import type { BillingStatus } from "../../contracts/billing";
import type { BaseContext } from "../../context";
import type { BillingCardSetupState, BillingPort } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "handoffs-test-secret";
process.env.NODE_ENV = "test";
// Billing marks and the card gate only run with the billing service on.
process.env.LOUEZ_BILLING = "cloud";
process.env.BILLING_SERVICE_URL = "http://localhost:3100";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}

// A dashboard session, read from a test header: Better Auth stays out.
const SESSION_HEADER = "x-test-session-user";
mock.module("@louez/auth", {
  namedExports: {
    auth: {},
    authInstance: {
      api: {
        getSession: async ({ headers }: { headers: Headers }) => {
          const id = headers.get(SESSION_HEADER);
          return id ? { user: { id, email: `${id}@ho.test` } } : null;
        },
      },
    },
  },
});

// Handoffs end to end on the database: an agent starts a step only the user
// can take (Stripe Connect, the billing card), the user opens the link,
// continues to a fake provider and comes back, and the agent reads where it
// stands. Stripe and the billing service are fakes; nothing leaves the test.

const OWNER = "ho_owner_user_000001";
const MEMBER = "ho_member_user_00001";
const STRANGER = "ho_other_user_000001";
const STORE = "ho_store_a_000000001";
const OTHER_STORE = "ho_store_b_000000001";
const HOUR = 3_600_000;

/** A Stripe client that records its calls and answers from `account`. */
function fakeStripe() {
  const calls = {
    created: [] as StripeAccountCreateParams[],
    links: [] as Array<{ account: string; return_url: string; refresh_url: string }>,
    loginLinks: 0,
    failLinks: false,
  };
  let account: StripeAccountLike = {
    type: "standard",
    country: "FR",
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    requirements: { currently_due: ["individual.id_number"], eventually_due: [], past_due: [] },
  };
  const client: StripeConnectClient = {
    accounts: {
      create: async (params) => {
        calls.created.push(params);
        return { id: `acct_test_${calls.created.length}` };
      },
      retrieve: async () => account,
      createLoginLink: async () => {
        calls.loginLinks += 1;
        return { url: "https://connect.stripe.test/express/login" };
      },
    },
    accountLinks: {
      create: async (params) => {
        if (calls.failLinks) throw new Error("Stripe is down");
        calls.links.push(params);
        return { url: `https://connect.stripe.test/setup/${params.account}` };
      },
    },
  };
  return {
    client,
    calls,
    set: (patch: StripeAccountLike) => {
      account = { ...account, ...patch };
    },
  };
}

/** The billing code's answers, set by each test. */
function fakeBilling() {
  const state = {
    billed: true,
    status: {
      billing: "service",
      mode: "pay_as_you_go",
      plan: null,
      offer: "4% per booking",
      notice: null,
      payAsYouGo: null,
      card: {
        state: "missing",
        brand: null,
        last4: null,
        expMonth: null,
        expYear: null,
        expired: false,
      },
      invoices: [],
      service: { reachable: true, month: null, balance: null },
      cardSetupOpen: true,
      cardSetupBlocked: null,
    } as Omit<BillingStatus, "gate" | "cardSetup" | "links"> & BillingCardSetupState,
    started: [] as Array<{ storeId: string; userId: string; locale: string; returnUrl: string }>,
    finished: [] as string[],
    outcome: "refreshed" as "refreshed" | "pending",
  };
  const port: BillingPort = {
    status: async () => state.status,
    billedByService: async () => state.billed,
    startCardSetup: async (input) => {
      state.started.push(input);
      return { ok: true, url: "https://checkout.stripe.test/c/cs_test_1" };
    },
    finishCardSetup: async ({ checkoutSessionId }) => {
      state.finished.push(checkoutSessionId);
      return state.outcome;
    },
  };
  return { state, port };
}

describe("handoffs (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let handoffs: typeof import("../../services/handoffs");
  let inbox: typeof import("../../services/inbox");
  let routers: {
    payments: typeof import("./payments").dashboardPaymentsRouter;
    billing: typeof import("./billing").dashboardBillingRouter;
    handoffs: typeof import("./handoffs").dashboardHandoffsRouter;
  };

  let stripe = fakeStripe();
  let stripeConfigured = true;
  let billing = fakeBilling();
  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: () => {},
    hostedBy: (): "lumycloud" | null => null,
    stripeConnect: () => (stripeConfigured ? stripe.client : null),
    get billing() {
      return billing.port;
    },
  };

  before(async () => {
    database = await createTestDatabase("api_handoffs");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    handoffs = await import("../../services/handoffs");
    inbox = await import("../../services/inbox");
    routers = {
      payments: (await import("./payments")).dashboardPaymentsRouter,
      billing: (await import("./billing")).dashboardBillingRouter,
      handoffs: (await import("./handoffs")).dashboardHandoffsRouter,
    };

    await louezDb.db.insert(louezDb.users).values([
      { id: OWNER, email: "owner@ho.test" },
      { id: MEMBER, email: "member@ho.test" },
      { id: STRANGER, email: "stranger@ho.test" },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    const { db } = louezDb;
    for (const table of [
      louezDb.apiHandoffs,
      louezDb.apiOperations,
      louezDb.apiKeys,
      louezDb.billingPolicies,
      louezDb.billingSyncQueue,
      louezDb.storeMembers,
      louezDb.stores,
    ]) {
      await db.delete(table);
    }
    stripe = fakeStripe();
    stripeConfigured = true;
    billing = fakeBilling();
    await db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: OWNER,
        name: "Brest Surf",
        slug: "ho-brest-surf",
        description: "<p>Planches &amp; combinaisons</p>",
        phone: "+33 6 00 00 00 00",
        settings: {
          reservationMode: "payment",
          advanceNoticeMinutes: 0,
          currency: "EUR",
          country: "FR",
        },
        onboardingCompleted: true,
      },
      {
        id: OTHER_STORE,
        userId: STRANGER,
        name: "Other",
        slug: "ho-other",
        settings: {
          reservationMode: "request",
          advanceNoticeMinutes: 0,
          currency: "EUR",
          country: "FR",
        },
        onboardingCompleted: true,
      },
    ]);
    await db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: STORE, userId: MEMBER, role: "member" },
      { storeId: OTHER_STORE, userId: STRANGER, role: "owner" },
    ]);
  });

  // --- Callers --------------------------------------------------------------

  function session(user = OWNER, store = STORE): BaseContext {
    return {
      headers: new Headers({ [SESSION_HEADER]: user, cookie: `louez_active_store=${store}` }),
      transport: "rpc",
      ports,
      receipt: {},
    };
  }

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const agentRights: Permissions = {
    reservations: "read",
    products: "none",
    customers: "none",
    categories: "none",
    payments: "none",
    analytics: "none",
    settings: "write",
    billing: "write",
  };

  async function apiKey(permissions: Permissions = agentRights, storeId = STORE, userId = OWNER) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId,
      userId,
      name: "Store agent",
      permissions,
    });
    return (): BaseContext => ({
      headers: new Headers({ authorization: `Bearer ${created.key}` }),
      transport: "mcp",
      ports,
      receipt: {},
    });
  }

  /** The three routers, called as the dashboard router serves them. */
  const client = (context: BaseContext) =>
    orpc.createRouterClient(routers, { context, path: ["dashboard"] }) as RouterClient<
      typeof routers
    >;

  async function rejects(promise: Promise<unknown>, code: string) {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, `expected ${code}, the call succeeded`);
    const { data, code: httpCode } = caught as { code?: string; data?: { code?: string } };
    assert.equal(data?.code ?? httpCode, code, String(caught));
  }

  /** The token of a link: the path after /handoffs/. */
  const tokenOf = (url: string) => {
    const prefix = `${TEST_APP_URL}/handoffs/`;
    assert.ok(url.startsWith(prefix), url);
    return url.slice(prefix.length);
  };

  const storeRow = async (id = STORE) => {
    const [row] = await louezDb.db
      .select()
      .from(louezDb.stores)
      .where(orm.eq(louezDb.stores.id, id));
    return row;
  };

  const handoffRows = () => louezDb.db.select().from(louezDb.apiHandoffs);

  /** A billing policy version in force for the store since an hour ago. */
  async function policy(
    reservations: { allowed: true } | { allowed: false; reason: "payment_method_required" },
  ) {
    const since = new Date(Math.floor((Date.now() - HOUR) / 1000) * 1000);
    await louezDb.db.insert(louezDb.billingPolicies).values({
      storeId: STORE,
      version: 1,
      effectiveFrom: since,
      receivedAt: since,
      body: {
        schema: "louez.billing.policy/1",
        storeId: STORE,
        version: 1,
        effectiveFrom: since.toISOString(),
        issuedAt: since.toISOString(),
        newStoresCreatedFrom: null,
        offerKey: "test-offer",
        invoicing: "service",
        currency: "EUR",
        applicationFee: { kind: "none" },
        marketplaceFeeMinor: 0,
        reservations,
        notice: null,
        stripeCustomerId: null,
        labels: { offer: { fr: "Offre", en: "Offer" }, notice: null },
      },
    });
    return since;
  }

  // --- The lifecycle ----------------------------------------------------------

  test("an agent hands Stripe's onboarding to the owner, who connects the store and comes back", async () => {
    const agent = await apiKey();
    const started = await client(agent()).payments.startStripeOnboarding({});
    assert.equal(started.handoff.kind, "stripe_connect_onboarding");
    assert.equal(started.handoff.status, "pending");
    assert.equal(
      started.handoff.links.dashboard,
      `${TEST_APP_URL}/dashboard/settings/payments?store=${STORE}`,
    );
    const hours = (started.handoff.expiresAt.getTime() - Date.now()) / HOUR;
    assert.ok(hours > 23.9 && hours <= 24, String(hours));
    const token = tokenOf(started.url);
    assert.equal(token.length, 64);
    assert.ok(!token.includes("."), "no dot: the proxy reads a dotted path as a static file");

    // Only a hash of the secret is stored.
    const [row] = await handoffRows();
    assert.equal(row?.id, started.handoff.id);
    assert.equal(row?.userId, OWNER);
    assert.equal(row?.credentialKind, "api_key");
    assert.ok(row?.tokenHash && !token.includes(row.tokenHash));
    // Nothing reached Stripe yet: the link only names the step.
    assert.equal(stripe.calls.created.length, 0);

    const read = await handoffs.readHandoffLink(token, OWNER);
    assert.equal(read.ok, true);
    assert.equal(read.ok && read.store.name, "Brest Surf");
    // Reading the page changes nothing.
    assert.equal((await handoffs.getHandoffRow(STORE, started.handoff.id)).status, "pending");

    const continued = await handoffs.continueHandoff(token, OWNER);
    assert.ok(continued.ok && continued.state);
    const launch = await handoffs.launchHandoff({
      row: continued.row,
      state: continued.state,
      userId: OWNER,
      locale: "fr",
      ports,
    });
    assert.deepEqual(launch, {
      ok: true,
      redirect: "https://connect.stripe.test/setup/acct_test_1",
    });

    // The account is opened with what the store knows (the old action's prefill).
    const [params] = stripe.calls.created;
    assert.equal(params?.type, "standard");
    assert.equal(params?.email, "owner@ho.test");
    assert.equal(params?.country, "FR");
    assert.equal(params?.business_profile.mcc, "7394");
    assert.equal(params?.business_profile.product_description, "Planches & combinaisons");
    assert.equal(params?.business_profile.support_phone, "+33 6 00 00 00 00");
    assert.equal(params?.settings?.payments.statement_descriptor, "BREST SURF");
    assert.equal(params?.metadata.storeId, STORE);
    assert.deepEqual(params?.capabilities, {
      card_payments: { requested: true },
      transfers: { requested: true },
    });
    assert.equal((await storeRow())?.stripeAccountId, "acct_test_1");
    const marks = await louezDb.db
      .select()
      .from(louezDb.billingSyncQueue)
      .where(orm.eq(louezDb.billingSyncQueue.storeId, STORE));
    assert.ok(
      marks.some((mark) => mark.aggregateType === "store"),
      "the store's snapshot is marked",
    );

    // Stripe comes back to Louez's return page, with the state of this click.
    const [link] = stripe.calls.links;
    const returnPrefix = `${TEST_APP_URL}/handoffs/return/${started.handoff.id}/`;
    assert.ok(link?.return_url.startsWith(returnPrefix), link?.return_url);
    assert.equal(
      link?.refresh_url,
      link?.return_url.replace("/handoffs/return/", "/handoffs/refresh/"),
    );
    const state = link?.return_url.slice(returnPrefix.length) ?? "";
    assert.equal(state, continued.state);

    const opened = await client(agent()).handoffs.get({ id: started.handoff.id });
    assert.equal(opened.status, "opened");
    assert.ok(opened.openedAt);

    // A forged state, or the right one for someone else, does nothing.
    assert.equal(
      (await handoffs.checkHandoffReturn(started.handoff.id, "x".repeat(43), OWNER)).ok,
      false,
    );
    const strangerReturn = await handoffs.checkHandoffReturn(started.handoff.id, state, STRANGER);
    assert.equal(strangerReturn.ok, false);
    assert.equal(!strangerReturn.ok && strangerReturn.reason, "other_user");

    // Back without submitting the form: still opened.
    const checked = await handoffs.checkHandoffReturn(started.handoff.id, state, OWNER);
    assert.ok(checked.ok);
    assert.deepEqual(
      await handoffs.finishHandoffReturn({ row: checked.row, ports, checkoutSessionId: null }),
      { done: false },
    );
    assert.equal((await client(agent()).handoffs.get({ id: started.handoff.id })).status, "opened");

    // Submitted: the store's columns follow Stripe, the handoff is completed.
    stripe.set({ details_submitted: true, charges_enabled: true, requirements: null });
    const again = await handoffs.checkHandoffReturn(started.handoff.id, state, OWNER);
    assert.ok(again.ok);
    assert.deepEqual(
      await handoffs.finishHandoffReturn({ row: again.row, ports, checkoutSessionId: null }),
      { done: true },
    );
    const store = await storeRow();
    assert.equal(store?.stripeChargesEnabled, true);
    assert.equal(store?.stripeOnboardingComplete, true);
    const done = await client(agent()).handoffs.get({ id: started.handoff.id });
    assert.equal(done.status, "completed");
    assert.match(done.summary, /finished Stripe's onboarding/);

    // The link is spent; the store takes payments now, so no new onboarding.
    const spent = await handoffs.readHandoffLink(token, OWNER);
    assert.equal(!spent.ok && spent.reason, "finished");
    await rejects(client(agent()).payments.startStripeOnboarding({}), "STRIPE_ALREADY_CONNECTED");
  });

  test("the link opens only for its user, still allowed in the store", async () => {
    const started = await client((await apiKey())()).payments.startStripeOnboarding({});
    const token = tokenOf(started.url);

    const stranger = await handoffs.readHandoffLink(token, STRANGER);
    assert.equal(!stranger.ok && stranger.reason, "other_user");
    const member = await handoffs.continueHandoff(token, MEMBER);
    assert.equal(!member.ok && member.reason, "other_user");
    assert.equal((await handoffs.getHandoffRow(STORE, started.handoff.id)).status, "pending");

    // The owner demoted after the link went out may no longer take the step.
    await louezDb.db
      .update(louezDb.storeMembers)
      .set({ role: "member" })
      .where(orm.eq(louezDb.storeMembers.userId, OWNER));
    const demoted = await handoffs.readHandoffLink(token, OWNER);
    assert.equal(!demoted.ok && demoted.reason, "not_allowed");

    const garbage = await handoffs.readHandoffLink("not-a-token", OWNER);
    assert.equal(!garbage.ok && garbage.reason, "invalid");
    const wrongSecret = await handoffs.readHandoffLink(
      `${started.handoff.id}${"A".repeat(43)}`,
      OWNER,
    );
    assert.equal(!wrongSecret.ok && wrongSecret.reason, "invalid");
  });

  test("a link expires after a day, and asking again resumes the same handoff with a new link", async () => {
    const agent = await apiKey();
    const first = await client(agent()).payments.startStripeOnboarding({});
    const firstToken = tokenOf(first.url);

    const later = new Date(Date.now() + 25 * HOUR);
    const expired = await handoffs.readHandoffLink(firstToken, OWNER, later);
    assert.equal(!expired.ok && expired.reason, "expired");
    const row = await handoffs.getHandoffRow(STORE, first.handoff.id);
    assert.equal(handoffs.statusOf(row, later), "expired");

    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(orm.eq(louezDb.apiHandoffs.id, first.handoff.id));
    assert.equal((await client(agent()).handoffs.get({ id: first.handoff.id })).status, "expired");

    // One active handoff per kind: the same one, a new link, the old one dead.
    const second = await client(agent()).payments.startStripeOnboarding({});
    assert.equal(second.handoff.id, first.handoff.id);
    assert.equal(second.handoff.status, "pending");
    assert.notEqual(second.url, first.url);
    const old = await handoffs.readHandoffLink(firstToken, OWNER);
    assert.equal(!old.ok && old.reason, "invalid");
    assert.equal((await handoffs.readHandoffLink(tokenOf(second.url), OWNER)).ok, true);
    assert.equal((await handoffRows()).length, 1);

    // Another kind is its own handoff; once completed, the next one is new.
    await louezDb.db
      .update(louezDb.stores)
      .set({ stripeAccountId: "acct_existing" })
      .where(orm.eq(louezDb.stores.id, STORE));
    const dashboard = await client(agent()).payments.openStripeDashboard({});
    assert.notEqual(dashboard.handoff.id, first.handoff.id);
    await handoffs.completeActiveHandoff(STORE, "stripe_connect_onboarding");
    const third = await client(agent()).payments.startStripeOnboarding({});
    assert.notEqual(third.handoff.id, first.handoff.id);
    assert.equal((await handoffRows()).length, 3);
  });

  test("another user asking for the same step starts it over for them", async () => {
    const owner = await client(session(OWNER)).payments.startStripeOnboarding({});
    const continued = await handoffs.continueHandoff(tokenOf(owner.url), OWNER);
    assert.ok(continued.ok);

    // A second owner of the store asks from their own session.
    await louezDb.db.insert(louezDb.storeMembers).values({
      storeId: STORE,
      userId: STRANGER,
      role: "owner",
    });
    const other = await client(session(STRANGER)).payments.startStripeOnboarding({});
    assert.equal(other.handoff.id, owner.handoff.id);
    assert.equal(other.handoff.status, "pending");
    const row = await handoffs.getHandoffRow(STORE, owner.handoff.id);
    assert.equal(row.userId, STRANGER);
    assert.equal(row.returnStateHash, null);
    const stale = await handoffs.checkHandoffReturn(owner.handoff.id, continued.state ?? "", OWNER);
    assert.equal(stale.ok, false);
  });

  test("Stripe's account.updated completes the active onboarding handoff", async () => {
    const started = await client((await apiKey())()).payments.startStripeOnboarding({});
    await handoffs.completeActiveHandoff(STORE, "stripe_connect_onboarding");
    const row = await handoffs.getHandoffRow(STORE, started.handoff.id);
    assert.equal(row.status, "completed");
    assert.equal(row.activeSlot, null);
    // A completed handoff is not completed twice, and the other store's is left.
    assert.equal(await handoffs.completeHandoff(started.handoff.id), false);
  });

  test("handoffs are the store's own, and need read access to their domain", async () => {
    const started = await client((await apiKey())()).payments.startStripeOnboarding({});
    const otherStore = await apiKey(agentRights, OTHER_STORE, STRANGER);
    await rejects(
      client(otherStore()).handoffs.get({ id: started.handoff.id }),
      "HANDOFF_NOT_FOUND",
    );
    const billingOnly = await apiKey({ ...agentRights, settings: "none", billing: "read" });
    await rejects(
      client(billingOnly()).handoffs.get({ id: started.handoff.id }),
      "PERMISSION_DENIED",
    );
    const reader = await apiKey({ ...agentRights, settings: "read", billing: "none" });
    assert.equal(
      (await client(reader()).handoffs.get({ id: started.handoff.id })).status,
      "pending",
    );
    // Starting one needs settings write and manage_settings.
    await rejects(client(reader()).payments.startStripeOnboarding({}), "PERMISSION_DENIED");
    await rejects(client(session(MEMBER)).payments.startStripeOnboarding({}), "PERMISSION_DENIED");
  });

  // --- Stripe -------------------------------------------------------------------

  test("Stripe's refusals: not configured, no account, no email, Stripe down", async () => {
    const agent = await apiKey();
    stripeConfigured = false;
    await rejects(client(agent()).payments.startStripeOnboarding({}), "STRIPE_NOT_CONFIGURED");
    stripeConfigured = true;
    await rejects(client(agent()).payments.openStripeDashboard({}), "NO_STRIPE_ACCOUNT");
    await rejects(client(agent()).payments.syncStripeStatus({}), "NO_STRIPE_ACCOUNT");

    // Stripe does not answer: the same link may try again.
    stripe.calls.failLinks = true;
    const started = await client(agent()).payments.startStripeOnboarding({});
    const continued = await handoffs.continueHandoff(tokenOf(started.url), OWNER);
    assert.ok(continued.ok && continued.state);
    const down = await handoffs.launchHandoff({
      row: continued.row,
      state: continued.state,
      userId: OWNER,
      locale: "en",
      ports,
    });
    assert.deepEqual(down, { ok: false, failure: "provider_failed", retryable: true });
    assert.equal((await handoffs.getHandoffRow(STORE, started.handoff.id)).status, "opened");

    // A country change leaves the pending account behind for a new one.
    stripe.calls.failLinks = false;
    stripe.set({ country: "BE" });
    const relaunch = await handoffs.launchHandoff({
      row: continued.row,
      state: continued.state,
      userId: OWNER,
      locale: "en",
      ports,
    });
    assert.equal(relaunch.ok, true);
    assert.equal(stripe.calls.created.length, 2, "a second account for the store's own country");

    // No email anywhere: the handoff fails and says why.
    await louezDb.db
      .update(louezDb.users)
      .set({ email: "" })
      .where(orm.eq(louezDb.users.id, OWNER));
    try {
      await louezDb.db
        .update(louezDb.stores)
        .set({ stripeAccountId: null, email: null })
        .where(orm.eq(louezDb.stores.id, STORE));
      const noEmail = await handoffs.launchHandoff({
        row: continued.row,
        state: continued.state,
        userId: OWNER,
        locale: "en",
        ports,
      });
      assert.deepEqual(noEmail, { ok: false, failure: "store_email_required", retryable: false });
      const failed = await client(agent()).handoffs.get({ id: started.handoff.id });
      assert.equal(failed.status, "failed");
      assert.equal(failed.failure?.code, "store_email_required");
    } finally {
      await louezDb.db
        .update(louezDb.users)
        .set({ email: "owner@ho.test" })
        .where(orm.eq(louezDb.users.id, OWNER));
    }
  });

  test("an expired Stripe link gives a new one for the same return", async () => {
    const started = await client((await apiKey())()).payments.startStripeOnboarding({});
    const continued = await handoffs.continueHandoff(tokenOf(started.url), OWNER);
    assert.ok(continued.ok && continued.state);
    await handoffs.launchHandoff({
      row: continued.row,
      state: continued.state,
      userId: OWNER,
      locale: "en",
      ports,
    });
    const checked = await handoffs.checkHandoffReturn(started.handoff.id, continued.state, OWNER);
    assert.ok(checked.ok);
    const url = await handoffs.refreshHandoffOnboarding({
      row: checked.row,
      state: continued.state,
      ports,
    });
    assert.equal(url, "https://connect.stripe.test/setup/acct_test_1");
    assert.equal(stripe.calls.created.length, 1, "the same account");
    assert.equal(stripe.calls.links[1]?.return_url, stripe.calls.links[0]?.return_url);
  });

  test("payments_sync_stripe_status saves Stripe's state, completes the handoff and says how the storefront books", async () => {
    const agent = await apiKey();
    const started = await client(agent()).payments.startStripeOnboarding({});
    await louezDb.db
      .update(louezDb.stores)
      .set({ stripeAccountId: "acct_existing" })
      .where(orm.eq(louezDb.stores.id, STORE));

    const pending = await client(agent()).payments.syncStripeStatus({});
    assert.equal(pending.chargesEnabled, false);
    assert.deepEqual(pending.bookingMode, { intended: "payment", effective: "request" });
    assert.deepEqual(pending.requirements.currentlyDue, ["individual.id_number"]);
    assert.equal((await handoffs.getHandoffRow(STORE, started.handoff.id)).status, "pending");

    stripe.set({ charges_enabled: true, details_submitted: true, payouts_enabled: true });
    const active = await client(agent()).payments.syncStripeStatus({});
    assert.deepEqual(active.bookingMode, { intended: "payment", effective: "payment" });
    assert.equal(
      active.links.dashboard,
      `${TEST_APP_URL}/dashboard/settings/payments?store=${STORE}`,
    );
    assert.equal((await storeRow())?.stripeOnboardingComplete, true);
    assert.equal((await handoffs.getHandoffRow(STORE, started.handoff.id)).status, "completed");
  });

  test("the Stripe dashboard handoff completes once the user is on their way", async () => {
    await louezDb.db
      .update(louezDb.stores)
      .set({ stripeAccountId: "acct_existing", stripeChargesEnabled: true })
      .where(orm.eq(louezDb.stores.id, STORE));
    const started = await client((await apiKey())()).payments.openStripeDashboard({});
    assert.equal(started.handoff.kind, "stripe_dashboard");
    const continued = await handoffs.continueHandoff(tokenOf(started.url), OWNER);
    assert.ok(continued.ok && continued.state);
    const launch = await handoffs.launchHandoff({
      row: continued.row,
      state: continued.state,
      userId: OWNER,
      locale: "en",
      ports,
    });
    // A Standard account signs in to Stripe itself: no login link is minted.
    assert.deepEqual(launch, { ok: true, redirect: "https://dashboard.stripe.com" });
    assert.equal(stripe.calls.loginLinks, 0);
    assert.equal((await handoffs.getHandoffRow(STORE, started.handoff.id)).status, "completed");

    stripe.set({ type: "express" });
    const express = await client((await apiKey())()).payments.openStripeDashboard({});
    const next = await handoffs.continueHandoff(tokenOf(express.url), OWNER);
    assert.ok(next.ok && next.state);
    const expressLaunch = await handoffs.launchHandoff({
      row: next.row,
      state: next.state,
      userId: OWNER,
      locale: "en",
      ports,
    });
    assert.deepEqual(expressLaunch, {
      ok: true,
      redirect: "https://connect.stripe.test/express/login",
    });
  });

  // --- Billing ------------------------------------------------------------------

  test("billing_get_status reads the billing code, the card gate and whether the card can be added", async () => {
    const agent = await apiKey();
    const status = await client(agent()).billing.getStatus({});
    assert.equal(status.billing, "service");
    assert.equal(status.offer, "4% per booking");
    assert.equal(status.card?.state, "missing");
    assert.deepEqual(status.gate, { acceptsReservations: true, reason: null, since: null });
    assert.deepEqual(status.cardSetup, { available: true, reason: null });
    assert.equal(
      status.links.dashboard,
      `${TEST_APP_URL}/dashboard/settings/billing?store=${STORE}`,
    );

    // A policy that refuses bookings until a card is added closes the gate, since it applies.
    const since = await policy({ allowed: false, reason: "payment_method_required" });
    const closed = await client(agent()).billing.getStatus({});
    assert.deepEqual(closed.gate, {
      acceptsReservations: false,
      reason: "payment_method_required",
      since,
    });

    // Legacy pay-as-you-go: Louez's own terms, the card in Stripe, no card setup here.
    billing.state.status = {
      ...billing.state.status,
      billing: "legacy",
      offer: null,
      payAsYouGo: {
        bands: [{ from: 1, to: null, fee: { amount: "1.50", currency: "EUR" } }],
        freeReservations: { granted: 10, remaining: 4 },
        month: {
          period: "2026-11",
          reservations: 3,
          fees: { amount: "4.50", currency: "EUR" },
          collectedAtSource: { amount: "1.50", currency: "EUR" },
          due: { amount: "3.00", currency: "EUR" },
        },
      },
      cardSetupOpen: false,
      cardSetupBlocked: "not_billed_by_service",
    };
    const legacy = await client(agent()).billing.getStatus({});
    assert.equal(legacy.payAsYouGo?.month.due.amount, "3.00");
    assert.deepEqual(legacy.cardSetup, { available: false, reason: "not_billed_by_service" });
    assert.equal(
      legacy.links.dashboard,
      `${TEST_APP_URL}/dashboard/settings/subscription?store=${STORE}`,
    );

    // A member does not manage billing; nor does a key without billing.
    await rejects(client(session(MEMBER)).billing.getStatus({}), "PERMISSION_DENIED");
    const noBilling = await apiKey({ ...agentRights, billing: "none" });
    await rejects(client(noBilling()).billing.getStatus({}), "PERMISSION_DENIED");
  });

  test("the owner adds the billing card through a handoff, completed on the return or later", async () => {
    const agent = await apiKey();
    const started = await client(agent()).billing.startCardSetup({});
    assert.equal(started.handoff.kind, "billing_card_setup");
    assert.equal(
      started.handoff.links.dashboard,
      `${TEST_APP_URL}/dashboard/settings/billing?store=${STORE}`,
    );

    const continued = await handoffs.continueHandoff(tokenOf(started.url), OWNER);
    assert.ok(continued.ok && continued.state);
    const launch = await handoffs.launchHandoff({
      row: continued.row,
      state: continued.state,
      userId: OWNER,
      locale: "fr",
      ports,
    });
    assert.deepEqual(launch, { ok: true, redirect: "https://checkout.stripe.test/c/cs_test_1" });
    const [setup] = billing.state.started;
    assert.equal(setup?.userId, OWNER);
    assert.equal(setup?.locale, "fr");
    // The billing service takes a return URL without a query: the state is in the path.
    assert.equal(
      setup?.returnUrl,
      `${TEST_APP_URL}/handoffs/return/${started.handoff.id}/${continued.state}`,
    );

    // Cancelled on Checkout: no session, still opened.
    const checked = await handoffs.checkHandoffReturn(started.handoff.id, continued.state, OWNER);
    assert.ok(checked.ok);
    assert.deepEqual(
      await handoffs.finishHandoffReturn({ row: checked.row, ports, checkoutSessionId: null }),
      { done: false },
    );

    // Back with a card Stripe has not confirmed yet: handoffs_get asks again later.
    billing.state.outcome = "pending";
    assert.deepEqual(
      await handoffs.finishHandoffReturn({
        row: checked.row,
        ports,
        checkoutSessionId: "cs_test_1",
      }),
      { done: false },
    );
    assert.equal((await client(agent()).handoffs.get({ id: started.handoff.id })).status, "opened");
    billing.state.outcome = "refreshed";
    const done = await client(agent()).handoffs.get({ id: started.handoff.id });
    assert.equal(done.status, "completed");
    assert.deepEqual(billing.state.finished, ["cs_test_1", "cs_test_1", "cs_test_1"]);
  });

  test("only the owner of a store the billing service bills may start the card setup", async () => {
    billing.state.billed = false;
    await rejects(client((await apiKey())()).billing.startCardSetup({}), "CARD_SETUP_UNAVAILABLE");
    billing.state.billed = true;
    // A member does not manage billing.
    await rejects(client(session(MEMBER)).billing.startCardSetup({}), "PERMISSION_DENIED");

    // An owner demoted after the link went out cannot open it.
    const started = await client((await apiKey())()).billing.startCardSetup({});
    await louezDb.db
      .update(louezDb.storeMembers)
      .set({ role: "member" })
      .where(
        orm.and(
          orm.eq(louezDb.storeMembers.userId, OWNER),
          orm.eq(louezDb.storeMembers.storeId, STORE),
        ),
      );
    const refused = await handoffs.readHandoffLink(tokenOf(started.url), OWNER);
    assert.equal(!refused.ok && refused.reason, "not_allowed");
  });

  // --- Inbox --------------------------------------------------------------------

  async function inboxItems(rights: { settings?: boolean; billing?: boolean } = {}) {
    const store = await storeRow();
    assert.ok(store);
    const result = await inbox.listInbox(
      {
        store: { ...store, availabilityRulesChangedAt: null },
        urls: ports.urls,
        hostedBy: null,
        reads: {
          reservations: true,
          settings: rights.settings ?? true,
          billing: rights.billing ?? true,
        },
        operationsOf: null,
      },
      {},
    );
    return result.items;
  }

  const waiting = (items: Awaited<ReturnType<typeof inboxItems>>) =>
    items.filter((item) => item.type === "handoff_waiting");

  test("a handoff waiting an hour, expired or failed shows in the inbox, the billing card only to who reads billing", async () => {
    const agent = await apiKey();
    const stripeStep = await client(agent()).payments.startStripeOnboarding({});
    const cardStep = await client(agent()).billing.startCardSetup({});
    assert.deepEqual(waiting(await inboxItems()), [], "a fresh link does not show");

    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ linkIssuedAt: new Date(Date.now() - 2 * HOUR) })
      .where(orm.eq(louezDb.apiHandoffs.id, stripeStep.handoff.id));
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ expiresAt: new Date(Date.now() - 2 * 60_000) })
      .where(orm.eq(louezDb.apiHandoffs.id, cardStep.handoff.id));

    const items = waiting(await inboxItems());
    const stripeItem = items.find((item) => item.details.handoffId === stripeStep.handoff.id);
    assert.equal(stripeItem?.id, `handoff_waiting:${stripeStep.handoff.id}`);
    assert.equal(stripeItem?.details.status, "pending");
    assert.deepEqual(stripeItem?.tools, ["handoffs_get", "payments_start_stripe_onboarding"]);
    assert.match(stripeItem?.summary ?? "", /more than an hour ago/);
    const cardItem = items.find((item) => item.details.handoffId === cardStep.handoff.id);
    assert.equal(cardItem?.details.status, "expired");
    assert.equal(cardItem?.severity, "warning");
    assert.deepEqual(cardItem?.tools, ["handoffs_get", "billing_start_card_setup"]);

    assert.deepEqual(
      waiting(await inboxItems({ billing: false })).map((item) => item.details.kind),
      ["stripe_connect_onboarding"],
    );
    assert.deepEqual(waiting(await inboxItems({ settings: false })), []);

    // A new link for the expired step: it leaves the inbox until it waits again.
    await client(agent()).billing.startCardSetup({});
    assert.deepEqual(
      waiting(await inboxItems()).map((item) => item.details.kind),
      ["stripe_connect_onboarding"],
    );

    // A failed step shows until the same step is started again.
    await handoffs.failHandoff(
      stripeStep.handoff.id,
      "not_available",
      new Date(Date.now() - 60_000),
    );
    const failed = waiting(await inboxItems());
    assert.equal(failed[0]?.details.status, "failed");
    assert.equal(failed[0]?.details.failureCode, "not_available");
    await client(agent()).payments.startStripeOnboarding({});
    assert.deepEqual(waiting(await inboxItems()), []);
  });

  test("a closed billing gate offers the tools that add the card", async () => {
    await policy({ allowed: false, reason: "payment_method_required" });
    const items = await inboxItems();
    const gate = items.find((item) => item.type === "billing_gate_closed");
    assert.deepEqual(gate?.tools, ["billing_get_status", "billing_start_card_setup"]);
  });

  test("an old finished handoff is purged after its retention", async () => {
    const started = await client((await apiKey())()).payments.startStripeOnboarding({});
    await handoffs.completeHandoff(started.handoff.id);
    assert.equal(await handoffs.purgeHandoffs(), 0);
    assert.equal(await handoffs.purgeHandoffs(new Date(Date.now() + 91 * 24 * HOUR)), 1);
    assert.deepEqual(await handoffRows(), []);
  });

  test("the answers that hold a link are never stored for a replay", async () => {
    const agent = await apiKey();
    const context = agent();
    context.headers.set("idempotency-key", "ho-replay-1");
    const first = await client(context).payments.startStripeOnboarding({});
    const second = await client(context).payments.startStripeOnboarding({});
    assert.notEqual(first.url, second.url);
    const operations = await louezDb.db.select().from(louezDb.apiOperations);
    assert.ok(operations.every((operation) => operation.result === null));
    assert.ok(
      operations.every((operation) => !JSON.stringify(operation).includes(tokenOf(second.url))),
      "no link in the audit trail",
    );
  });
});
