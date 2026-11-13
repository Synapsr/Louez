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
import type { HandoffKind } from "../../contracts/handoffs";
import type { BaseContext } from "../../context";
import type { BillingCardSetupState, BillingPort } from "../../platform/ports";

import { sha256 } from "../../platform/hash";
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
    /** When set, each check waits for it: a barrier for races. */
    gate: null as Promise<void> | null,
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
      if (state.gate) await state.gate;
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
  let HANDOFF_KINDS: typeof import("../../contracts/handoffs").HANDOFF_KINDS;
  let HANDOFF_TTL_HOURS: number;
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
    ({ HANDOFF_KINDS, HANDOFF_TTL_HOURS } = await import("../../contracts/handoffs"));
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

  /** The link's path after /handoffs/: the step's id. */
  const tokenOf = (url: string) => {
    const prefix = `${TEST_APP_URL}/handoffs/`;
    assert.ok(url.startsWith(prefix), url);
    return url.slice(prefix.length);
  };

  /** The revision the step's page shows now. */
  const shownRevision = async (link: string) => {
    const [row] = await louezDb.db
      .select({ revision: louezDb.apiHandoffs.revision })
      .from(louezDb.apiHandoffs)
      .where(orm.eq(louezDb.apiHandoffs.id, link.slice(0, 21)));
    return row?.revision ?? 0;
  };

  /** The user continues from the page, as it shows the step now unless `revision` says otherwise. */
  const continueAs = async (link: string, userId: string, revision?: number) =>
    handoffs.continueHandoff(link, userId, revision ?? (await shownRevision(link)));

  /**
   * A link given before links were addressed by id: the id then a secret,
   * whose hash the row holds as it did when the secret was the link's credential.
   */
  async function olderLink(id: string, secret = "S".repeat(43)) {
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ tokenHash: sha256(secret) })
      .where(orm.eq(louezDb.apiHandoffs.id, id));
    return `${id}${secret}`;
  }

  const storeRow = async (id = STORE) => {
    const [row] = await louezDb.db
      .select()
      .from(louezDb.stores)
      .where(orm.eq(louezDb.stores.id, id));
    return row;
  };

  const handoffRows = () => louezDb.db.select().from(louezDb.apiHandoffs);

  /** The provider-check lease runs out, as if its time had passed (it is on the database's clock). */
  const endLease = (id: string) =>
    louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ providerCheckAt: new Date(Date.now() - 60_000) })
      .where(orm.eq(louezDb.apiHandoffs.id, id));

  /** A barrier: `wait` resolves once `open` is called. */
  function barrier() {
    let open: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  }

  /** A billing card handoff the owner continued: its row and the click's state. */
  async function cardAttempt(agent: () => BaseContext) {
    const started = await client(agent()).billing.startCardSetup({});
    const continued = await continueAs(tokenOf(started.url), OWNER);
    assert.ok(continued.ok && continued.state);
    return { id: started.handoff.id, token: tokenOf(started.url), state: continued.state };
  }

  /** The return of an attempt, checked as the return route does. */
  async function returning(id: string, state: string, checkoutSessionId: string | null) {
    const checked = await handoffs.checkHandoffReturn(id, state, OWNER);
    assert.ok(checked.ok, "the return is valid when checked");
    return () =>
      handoffs.finishHandoffReturn({ row: checked.row, state, ports, checkoutSessionId });
  }

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
    assert.equal(token, started.handoff.id, "the link is the step's page, by its id");
    assert.ok(!token.includes("."), "no dot: the proxy reads a dotted path as a static file");

    // Every row still holds a hash, of a secret nobody received.
    const [row] = await handoffRows();
    assert.equal(row?.id, started.handoff.id);
    assert.equal(row?.userId, OWNER);
    assert.equal(row?.credentialKind, "api_key");
    assert.match(row?.tokenHash ?? "", /^[0-9a-f]{64}$/);
    assert.equal(row?.revision, 1);
    // Nothing reached Stripe yet: the link only names the step.
    assert.equal(stripe.calls.created.length, 0);

    const read = await handoffs.readHandoffLink(token, OWNER);
    assert.equal(read.ok, true);
    assert.equal(read.ok && read.store.name, "Brest Surf");
    // Reading the page changes nothing.
    assert.equal((await handoffs.getHandoffRow(STORE, started.handoff.id)).status, "pending");

    const continued = await continueAs(token, OWNER);
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
      await handoffs.finishHandoffReturn({
        row: checked.row,
        state,
        ports,
        checkoutSessionId: null,
      }),
      { done: false },
    );
    assert.equal((await client(agent()).handoffs.get({ id: started.handoff.id })).status, "opened");

    // A reload within the first return's lease reads the stored status only.
    const reload = await handoffs.checkHandoffReturn(started.handoff.id, state, OWNER);
    assert.ok(reload.ok);
    stripe.set({ details_submitted: true, charges_enabled: true, requirements: null });
    assert.deepEqual(
      await handoffs.finishHandoffReturn({
        row: reload.row,
        state,
        ports,
        checkoutSessionId: null,
      }),
      { done: false },
    );
    assert.equal((await storeRow())?.stripeChargesEnabled, false, "Stripe was not asked again");

    // Submitted, once the lease ended: the store's columns follow Stripe, the handoff is completed.
    await endLease(started.handoff.id);
    const again = await handoffs.checkHandoffReturn(started.handoff.id, state, OWNER);
    assert.ok(again.ok);
    assert.deepEqual(
      await handoffs.finishHandoffReturn({ row: again.row, state, ports, checkoutSessionId: null }),
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
    const member = await continueAs(token, MEMBER);
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

  // --- What a link keeps doing ---------------------------------------------------

  test("a link given with its secret opens and continues for its user", async () => {
    const started = await client((await apiKey())()).payments.startStripeOnboarding({});
    const token = await olderLink(started.handoff.id);

    const read = await handoffs.readHandoffLink(token, OWNER);
    assert.ok(read.ok);
    assert.equal(read.row.id, started.handoff.id);
    const continued = await continueAs(token, OWNER);
    assert.ok(continued.ok && continued.state);
    assert.equal((await handoffs.getHandoffRow(STORE, started.handoff.id)).status, "opened");
  });

  test("the page refuses another user, a removed member and a revoked connection, and changes nothing", async () => {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Refused agent",
      permissions: agentRights,
    });
    const agent = (): BaseContext => ({
      headers: new Headers({ authorization: `Bearer ${created.key}` }),
      transport: "mcp",
      ports,
      receipt: {},
    });
    const started = await client(agent()).payments.startStripeOnboarding({});
    const token = tokenOf(started.url);

    for (const user of [STRANGER, MEMBER]) {
      const read = await handoffs.readHandoffLink(token, user);
      assert.equal(!read.ok && read.reason, "other_user", user);
      const continued = await continueAs(token, user);
      assert.equal(!continued.ok && continued.reason, "other_user", user);
    }

    // The link's user, no longer a member of the store.
    await louezDb.db
      .delete(louezDb.storeMembers)
      .where(
        orm.and(
          orm.eq(louezDb.storeMembers.storeId, STORE),
          orm.eq(louezDb.storeMembers.userId, OWNER),
        ),
      );
    const removed = await handoffs.readHandoffLink(token, OWNER);
    assert.equal(!removed.ok && removed.reason, "not_allowed");
    const removedContinue = await continueAs(token, OWNER);
    assert.equal(!removedContinue.ok && removedContinue.reason, "not_allowed");
    await louezDb.db.insert(louezDb.storeMembers).values({
      storeId: STORE,
      userId: OWNER,
      role: "owner",
    });

    // The connection that asked, revoked.
    await louezDb.db
      .update(louezDb.apiKeys)
      .set({ revokedAt: new Date() })
      .where(orm.eq(louezDb.apiKeys.id, created.id));
    const revoked = await continueAs(token, OWNER);
    assert.equal(!revoked.ok && revoked.reason, "invalid");

    const row = await handoffs.getHandoffRow(STORE, started.handoff.id);
    assert.equal(row.status, "pending");
    assert.equal(row.returnStateHash, null);
  });

  test("a Stripe attempt survives the agent asking again: its return still completes the step", async () => {
    const agent = await apiKey();
    const started = await client(agent()).payments.startStripeOnboarding({});
    const continued = await continueAs(tokenOf(started.url), OWNER);
    assert.ok(continued.ok && continued.state);
    await handoffs.launchHandoff({
      row: continued.row,
      state: continued.state,
      userId: OWNER,
      locale: "fr",
      ports,
    });
    const inFlight = await handoffs.getHandoffRow(STORE, started.handoff.id);

    // The agent asks again while the user is on Stripe's page.
    const again = await client(agent()).payments.startStripeOnboarding({});
    assert.equal(again.handoff.id, started.handoff.id);
    const asked = await handoffs.getHandoffRow(STORE, started.handoff.id);
    assert.equal(asked.status, "opened");
    assert.equal(asked.returnStateHash, inFlight.returnStateHash);
    assert.equal(asked.providerChecks, inFlight.providerChecks);

    stripe.set({ details_submitted: true, charges_enabled: true, requirements: null });
    const back = await handoffs.checkHandoffReturn(started.handoff.id, continued.state, OWNER);
    assert.ok(back.ok);
    assert.deepEqual(
      await handoffs.finishHandoffReturn({
        row: back.row,
        state: continued.state,
        ports,
        checkoutSessionId: null,
      }),
      { done: true },
    );
    // A second return of the same attempt within its lease reads the stored status.
    const reload = await handoffs.checkHandoffReturn(started.handoff.id, continued.state, OWNER);
    assert.ok(reload.ok);
    assert.equal(reload.row.status, "completed");
  });

  // --- A link addressed by id ---------------------------------------------------

  test("handoffs_get gives the step's link, the one its start gave, and never a secret", async () => {
    const agent = await apiKey();
    const started = await client(agent()).payments.startStripeOnboarding({});
    assert.equal(started.url, `${TEST_APP_URL}/handoffs/${started.handoff.id}`);
    assert.equal(started.handoff.url, started.url);

    const read = await client(agent()).handoffs.get({ id: started.handoff.id });
    assert.equal(read.url, started.url);
    const [row] = await handoffRows();
    const answer = JSON.stringify(read);
    assert.ok(row?.tokenHash && !answer.includes(row.tokenHash), "no hash in the answer");
    assert.doesNotMatch(answer, /\/handoffs\/[A-Za-z0-9_-]{22,}/, "no secret after the id");
  });

  test("asking again keeps the link, pushes its expiry back and raises the revision", async () => {
    const agent = await apiKey();
    const first = await client(agent()).payments.startStripeOnboarding({});
    const older = await olderLink(first.handoff.id);
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ expiresAt: new Date(first.handoff.expiresAt.getTime() - 60_000) })
      .where(orm.eq(louezDb.apiHandoffs.id, first.handoff.id));
    const before = await handoffs.getHandoffRow(STORE, first.handoff.id);

    const second = await client(agent()).payments.startStripeOnboarding({});
    assert.equal(second.url, first.url);
    assert.equal(second.handoff.id, first.handoff.id);
    const after = await handoffs.getHandoffRow(STORE, first.handoff.id);
    assert.ok(after.expiresAt > before.expiresAt, "the expiry is pushed back");
    assert.equal(after.revision, before.revision + 1);
    assert.notEqual(after.tokenHash, before.tokenHash, "a new hash, of a secret nobody received");
    // A link with a secret given before stops opening, as a replaced link did.
    const replaced = await handoffs.readHandoffLink(older, OWNER);
    assert.equal(!replaced.ok && replaced.reason, "invalid");
    assert.equal((await handoffs.readHandoffLink(tokenOf(first.url), OWNER)).ok, true);
  });

  test("a page opened before the agent asked again continues nothing, and shows the step again", async () => {
    const agent = await apiKey();
    const started = await client(agent()).payments.startStripeOnboarding({});
    const link = tokenOf(started.url);
    const page = await handoffs.readHandoffLink(link, OWNER);
    assert.ok(page.ok);
    const shown = page.row.revision;

    await client(agent()).payments.startStripeOnboarding({});
    const stale = await continueAs(link, OWNER, shown);
    assert.equal(!stale.ok && stale.reason, "changed");
    const row = await handoffs.getHandoffRow(STORE, started.handoff.id);
    assert.equal(row.status, "pending");
    assert.equal(row.returnStateHash, null, "no attempt started");
    assert.equal(stripe.calls.created.length, 0);

    // The page shows it again, at its new revision: that click continues.
    const again = await handoffs.readHandoffLink(link, OWNER);
    assert.ok(again.ok);
    const continued = await continueAs(link, OWNER, again.row.revision);
    assert.ok(continued.ok && continued.state);
  });

  test("the id alone opens nothing for another user, another store's, a guessed id or a forged revision", async () => {
    const started = await client((await apiKey())()).payments.startStripeOnboarding({});
    const link = tokenOf(started.url);
    const revision = await shownRevision(link);

    // Another store's owner, and a member of the step's own store.
    for (const user of [STRANGER, MEMBER]) {
      const read = await handoffs.readHandoffLink(link, user);
      assert.equal(!read.ok && read.reason, "other_user", user);
      assert.equal(read.ok, false);
      const continued = await continueAs(link, user, revision);
      assert.equal(!continued.ok && continued.reason, "other_user", user);
    }
    // An id no step has.
    const guessed = await handoffs.readHandoffLink("Zz".repeat(10) + "Z", OWNER);
    assert.equal(!guessed.ok && guessed.reason, "invalid");
    assert.equal(!guessed.ok && guessed.row, null);
    // A revision the page never showed.
    for (const forged of [revision + 1, revision - 1, 0]) {
      const continued = await continueAs(link, OWNER, forged);
      assert.equal(!continued.ok && continued.reason, "changed", String(forged));
    }
    const row = await handoffs.getHandoffRow(STORE, started.handoff.id);
    assert.equal(row.status, "pending");
    assert.equal(row.returnStateHash, null);
  });

  /**
   * Resolves once a statement of this test's database whose text is `LIKE
   * pattern` is in progress: while the lock it needs is held at a barrier, it
   * can only be waiting for that lock.
   */
  async function lockWait(pattern: string) {
    for (let tries = 0; tries < 500; tries += 1) {
      const [rows] = (await louezDb.db.execute(
        orm.sql`SELECT COUNT(*) AS n FROM information_schema.processlist
          WHERE db = DATABASE() AND command = 'Query' AND info LIKE ${pattern}`,
      )) as unknown as [Array<{ n: number | string }>];
      if (Number(rows[0]?.n) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`no statement waited for a lock: ${pattern}`);
  }

  test("the agent's request committed between the page's read and the click's write: the click continues nothing", async () => {
    const agent = await apiKey();
    const started = await client(agent()).payments.startStripeOnboarding({});
    const link = tokenOf(started.url);
    const shown = await shownRevision(link);
    const row = await handoffs.getHandoffRow(STORE, started.handoff.id);

    // The repeated request holds the store's lock and the step's row.
    const entered = barrier();
    const gate = barrier();
    const repeat = handoffs.issueHandoff(
      {
        storeId: STORE,
        userId: row.userId,
        credentialKind: row.credentialKind,
        credentialId: row.credentialId,
        clientName: row.clientName,
      },
      "stripe_connect_onboarding",
      {
        urls: ports.urls,
        prepare: async () => {
          entered.open();
          await gate.wait;
          return null;
        },
      },
    );
    await entered.wait;
    // The click read the step at the page's revision, and its write waits for the row.
    const click = continueAs(link, OWNER, shown);
    try {
      await lockWait("update `api_handoffs`%");
    } finally {
      gate.open();
      await repeat;
    }

    const continued = await click;
    assert.equal(!continued.ok && continued.reason, "changed");
    const after = await handoffs.getHandoffRow(STORE, started.handoff.id);
    assert.equal(after.revision, shown + 1);
    assert.equal(after.status, "pending");
    assert.equal(after.returnStateHash, null, "no attempt started");
    assert.equal(stripe.calls.created.length, 0);
  });

  test("a step that became another user's while the click waited, its revision left as shown: the click continues nothing", async () => {
    const agent = await apiKey();
    const started = await client(agent()).payments.startStripeOnboarding({});
    const link = tokenOf(started.url);
    const shown = await shownRevision(link);
    await louezDb.db.insert(louezDb.storeMembers).values({
      storeId: STORE,
      userId: STRANGER,
      role: "owner",
    });

    // A writer that leaves the revision alone (the code before revisions) gives
    // the step to another owner, and holds its row until the click waits for it.
    const entered = barrier();
    const gate = barrier();
    const handedOver = louezDb.db.transaction(async (tx) => {
      await tx
        .update(louezDb.apiHandoffs)
        .set({ userId: STRANGER, tokenHash: sha256("old-writer") })
        .where(orm.eq(louezDb.apiHandoffs.id, started.handoff.id));
      entered.open();
      await gate.wait;
    });
    await entered.wait;
    // The click read the step as the first owner's, and its write waits for the row.
    const click = continueAs(link, OWNER, shown);
    try {
      await lockWait("update `api_handoffs`%");
    } finally {
      gate.open();
      await handedOver;
    }

    const continued = await click;
    assert.equal(!continued.ok && continued.reason, "changed");
    const after = await handoffs.getHandoffRow(STORE, started.handoff.id);
    assert.equal(after.userId, STRANGER);
    assert.equal(after.revision, shown, "the revision was not raised");
    assert.equal(after.status, "pending");
    assert.equal(after.returnStateHash, null, "no attempt started");
    assert.equal(stripe.calls.created.length, 0);
  });

  test("another user gets one answer, whatever the step's state", async () => {
    const states = {
      active: {},
      opened: {},
      expired: { expiresAt: new Date(Date.now() - 60_000) },
      completed: { status: "completed" as const, completedAt: new Date(), activeSlot: null },
      failed: {
        status: "failed" as const,
        failedAt: new Date(),
        failureCode: "not_available",
        activeSlot: null,
      },
    };
    const nothing = { ok: false, reason: "other_user", row: null };
    for (const [state, patch] of Object.entries(states)) {
      await louezDb.db.delete(louezDb.apiHandoffs);
      const started = await client((await apiKey())()).payments.startStripeOnboarding({});
      const id = started.handoff.id;
      const link = tokenOf(started.url);
      const revision = await shownRevision(link);
      // The step's user clicked: the return's state exists.
      const clicked = await continueAs(link, OWNER);
      assert.ok(clicked.ok && clicked.state);
      if (state === "active") {
        await louezDb.db
          .update(louezDb.apiHandoffs)
          .set({ status: "pending", openedAt: null })
          .where(orm.eq(louezDb.apiHandoffs.id, id));
      }
      if (Object.keys(patch).length > 0) {
        await louezDb.db
          .update(louezDb.apiHandoffs)
          .set(patch)
          .where(orm.eq(louezDb.apiHandoffs.id, id));
      }
      // A member of the step's store, and another store's owner.
      for (const user of [MEMBER, STRANGER]) {
        const label = `${state}, ${user}`;
        assert.deepEqual(await handoffs.readHandoffLink(link, user), nothing, label);
        assert.deepEqual(await handoffs.readHandoffForUser(id, user), nothing, label);
        assert.deepEqual(await continueAs(link, user, revision), nothing, label);
        // Even holding the return's state.
        assert.deepEqual(
          await handoffs.checkHandoffReturn(id, clicked.state, user),
          nothing,
          label,
        );
      }
    }
  });

  test("a link expires after a day, and asking again resumes the same handoff with the same link", async () => {
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

    // One active handoff per kind: the same one, the same link, open again.
    const second = await client(agent()).payments.startStripeOnboarding({});
    assert.equal(second.handoff.id, first.handoff.id);
    assert.equal(second.handoff.status, "pending");
    assert.equal(second.url, first.url);
    assert.equal((await handoffs.readHandoffLink(firstToken, OWNER)).ok, true);
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
    const continued = await continueAs(tokenOf(owner.url), OWNER);
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
      "HANDOFF_NOT_FOUND",
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

  /** A step of each kind in the store, asked for by the owner's session. */
  async function oneStepOfEachKind(now?: Date) {
    const requester = {
      storeId: STORE,
      userId: OWNER,
      credentialKind: "session",
      credentialId: null,
      clientName: null,
    };
    const steps = {} as Record<HandoffKind, string>;
    for (const kind of HANDOFF_KINDS) {
      const issued = await handoffs.issueHandoff(requester, kind, {
        urls: ports.urls,
        now,
        prepare:
          kind === "team_invitation"
            ? async () => ({ email: "new@ho.test", role: "member", joinsAtOnce: false })
            : undefined,
      });
      steps[kind] = issued.handoff.id;
    }
    return steps;
  }

  test("who reads which step: each credential reads the kinds of the domains it reads, and only those", async () => {
    const steps = await oneStepOfEachKind();
    const none: Permissions = {
      reservations: "none",
      products: "none",
      customers: "none",
      categories: "none",
      payments: "none",
      analytics: "none",
      settings: "none",
      online_store: "none",
      integrations: "none",
      team: "none",
      billing: "none",
    };
    const domains = Object.keys(none) as Array<keyof Permissions>;
    // Who reads which step, written out: settings reads Stripe's steps, billing
    // the card, the team an invitation's approval; a session reads every step.
    // A caller who reads no domain is refused before any step is looked at; one
    // who reads another domain gets the answer an id no step has gets.
    const READS: Record<string, HandoffKind[]> = {
      settings: ["stripe_connect_onboarding", "stripe_dashboard"],
      billing: ["billing_card_setup"],
      team: ["team_invitation"],
    };
    const callers: Array<{ label: string; context: () => BaseContext; reads: HandoffKind[] }> = [
      { label: "no domain", context: await apiKey(none), reads: [] },
      ...(await Promise.all(
        domains.map(async (domain) => ({
          label: `${domain} read`,
          context: await apiKey({ ...none, [domain]: "read" }),
          reads: READS[domain] ?? [],
        })),
      )),
      { label: "the owner's session", context: () => session(OWNER), reads: [...HANDOFF_KINDS] },
      { label: "a member's session", context: () => session(MEMBER), reads: [...HANDOFF_KINDS] },
    ];
    for (const caller of callers) {
      for (const kind of HANDOFF_KINDS) {
        const label = `${caller.label}, ${kind}`;
        const read = client(caller.context()).handoffs.get({ id: steps[kind] });
        if (caller.reads.includes(kind)) {
          assert.equal((await read).kind, kind, label);
        } else {
          await rejects(
            read,
            caller.label === "no domain" ? "PERMISSION_DENIED" : "HANDOFF_NOT_FOUND",
          );
        }
      }
    }
  });

  test("every kind's link lasts as long from each request: a day, as before", async () => {
    const first = new Date(Date.now() - HOUR);
    const steps = await oneStepOfEachKind(first);
    const lifetime = HANDOFF_TTL_HOURS * HOUR;
    for (const kind of HANDOFF_KINDS) {
      const row = await handoffs.getHandoffRow(STORE, steps[kind]);
      assert.equal(row.expiresAt.getTime() - first.getTime(), lifetime, kind);
      assert.equal(row.linkIssuedAt.getTime(), first.getTime(), kind);
    }
    // Asked again: the same step, as long again from the new request.
    const again = new Date();
    const same = await oneStepOfEachKind(again);
    for (const kind of HANDOFF_KINDS) {
      assert.equal(same[kind], steps[kind], kind);
      const row = await handoffs.getHandoffRow(STORE, steps[kind]);
      assert.equal(row.expiresAt.getTime() - again.getTime(), lifetime, kind);
    }
  });

  test("each kind declares its lifetime, and its link lasts that long from each request", async () => {
    assert.deepEqual(Object.keys(handoffs.HANDOFF_LIFETIMES).sort(), [...HANDOFF_KINDS].sort());
    const now = new Date(Date.now() - HOUR);
    const steps = await oneStepOfEachKind(now);
    for (const kind of HANDOFF_KINDS) {
      const row = await handoffs.getHandoffRow(STORE, steps[kind]);
      assert.equal(row.expiresAt.getTime(), handoffs.linkExpiry(kind, now).getTime(), kind);
    }
  });

  test("handoffs_get opens to any domain's read: a step of a domain not read answers as an id no step has", async () => {
    const steps = await oneStepOfEachKind();
    const reservationsOnly = await apiKey({
      ...agentRights,
      settings: "none",
      billing: "none",
      team: "none",
    });
    const refusal = (id: string) =>
      client(reservationsOnly())
        .handoffs.get({ id })
        .then(
          () => null,
          (error: { data?: { code?: string }; message?: string }) => ({
            code: error.data?.code,
            message: error.message?.replaceAll(id, "<id>"),
          }),
        );
    const unknown = await refusal("x".repeat(21));
    assert.equal(unknown?.code, "HANDOFF_NOT_FOUND");
    for (const kind of HANDOFF_KINDS) {
      assert.deepEqual(await refusal(steps[kind]), unknown, kind);
    }
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
    const continued = await continueAs(tokenOf(started.url), OWNER);
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
    const continued = await continueAs(tokenOf(started.url), OWNER);
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
    const continued = await continueAs(tokenOf(started.url), OWNER);
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
    const next = await continueAs(tokenOf(express.url), OWNER);
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

    const continued = await continueAs(tokenOf(started.url), OWNER);
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
    const state = continued.state;
    assert.deepEqual(
      await handoffs.finishHandoffReturn({
        row: checked.row,
        state,
        ports,
        checkoutSessionId: null,
      }),
      { done: false },
    );

    // Back with a card Stripe has not confirmed yet: handoffs_refresh asks again once the lease ends.
    billing.state.outcome = "pending";
    assert.deepEqual(
      await handoffs.finishHandoffReturn({
        row: checked.row,
        state,
        ports,
        checkoutSessionId: "cs_test_1",
      }),
      { done: false },
    );
    billing.state.outcome = "refreshed";
    assert.equal(
      (await client(agent()).handoffs.refresh({ id: started.handoff.id })).status,
      "opened",
    );
    assert.deepEqual(billing.state.finished, ["cs_test_1"], "the return's lease holds the polls");
    await endLease(started.handoff.id);
    // Reading never asks the provider: it says the card is being confirmed.
    const read = await client(agent()).handoffs.get({ id: started.handoff.id });
    assert.equal(read.status, "opened");
    assert.equal(read.confirming, true);
    assert.deepEqual(billing.state.finished, ["cs_test_1"], "handoffs_get only reads");
    const done = await client(agent()).handoffs.refresh({ id: started.handoff.id });
    assert.equal(done.status, "completed");
    assert.equal(done.confirming, false);
    assert.deepEqual(billing.state.finished, ["cs_test_1", "cs_test_1"]);

    // Settling saves the card: a connection that only reads billing may not.
    const billingReader = await apiKey({ ...agentRights, billing: "read" });
    await rejects(
      client(billingReader()).handoffs.refresh({ id: started.handoff.id }),
      "PERMISSION_DENIED",
    );
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

  test("a handoff waiting an hour, expired or failed shows in the inbox, each step to who reads its domain", async () => {
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
    // The item links to the step's own page, where its user takes it.
    assert.deepEqual(stripeItem?.links, {
      dashboard: `${TEST_APP_URL}/handoffs/${stripeStep.handoff.id}`,
    });
    const cardItem = items.find((item) => item.details.handoffId === cardStep.handoff.id);
    assert.equal(cardItem?.details.status, "expired");
    assert.equal(cardItem?.severity, "warning");
    assert.deepEqual(cardItem?.tools, ["handoffs_get", "billing_start_card_setup"]);

    assert.deepEqual(
      waiting(await inboxItems({ billing: false })).map((item) => item.details.kind),
      ["stripe_connect_onboarding"],
    );
    // Each step by its own domain: billing alone shows the card, not Stripe.
    assert.deepEqual(
      waiting(await inboxItems({ settings: false })).map((item) => item.details.kind),
      ["billing_card_setup"],
    );

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

  test("old handoffs are purged after their retention, oldest first, in batches", async () => {
    const started = await client((await apiKey())()).payments.startStripeOnboarding({});
    await handoffs.completeHandoff(started.handoff.id);
    assert.equal(await handoffs.purgeHandoffs(), 0);
    const old = new Date(Date.now() - 100 * 24 * HOUR);
    await louezDb.db.insert(louezDb.apiHandoffs).values(
      [1, 2, 3, 4, 5].map((index) => ({
        storeId: STORE,
        kind: "stripe_dashboard" as const,
        status: "completed" as const,
        userId: OWNER,
        credentialKind: "session",
        tokenHash: `old_${index}`,
        linkIssuedAt: old,
        expiresAt: old,
        createdAt: old,
        updatedAt: new Date(old.getTime() + index * 1000),
      })),
    );
    // Batches of two, with no time left after the first: the next run goes on.
    assert.equal(await handoffs.purgeHandoffs(new Date(), { batch: 2, budgetMs: 0 }), 2);
    const left = (await handoffRows()).map((row) => row.tokenHash).sort();
    assert.deepEqual(
      left.filter((hash) => hash.startsWith("old_")),
      ["old_3", "old_4", "old_5"],
    );
    assert.equal(await handoffs.purgeHandoffs(new Date(), { batch: 2 }), 3);
    assert.equal((await handoffRows()).length, 1, "the recent one stays");
  });

  // --- Attempts: a new click, a stale return, concurrent polls -------------------

  test("a new click drops the earlier attempt's Checkout: polling never finishes it", async () => {
    const agent = await apiKey();
    const a = await cardAttempt(agent);
    billing.state.outcome = "pending";
    assert.deepEqual(await (await returning(a.id, a.state, "cs_attempt_a"))(), { done: false });
    assert.equal((await handoffs.getHandoffRow(STORE, a.id)).providerRef, "cs_attempt_a");

    // Continue again: attempt B, with no Checkout yet.
    const b = await continueAs(a.token, OWNER);
    assert.ok(b.ok && b.state);
    const row = await handoffs.getHandoffRow(STORE, a.id);
    assert.equal(row.providerRef, null);
    assert.equal(row.providerCheckAt, null);
    assert.equal(row.providerChecks, 0);

    // Checkout A is confirmed now; polls do not ask about it.
    billing.state.outcome = "refreshed";
    billing.state.finished.length = 0;
    assert.equal((await client(agent()).handoffs.refresh({ id: a.id })).status, "opened");
    assert.deepEqual(billing.state.finished, []);
    // A's late return changes nothing either.
    assert.deepEqual(
      await handoffs.finishHandoffReturn({
        row,
        state: a.state,
        ports,
        checkoutSessionId: "cs_attempt_a",
      }),
      { done: false },
    );
    assert.deepEqual(billing.state.finished, [], "a stale return never reaches the provider");

    // B's own Checkout completes it.
    billing.state.outcome = "pending";
    await (
      await returning(a.id, b.state, "cs_attempt_b")
    )();
    billing.state.outcome = "refreshed";
    await endLease(a.id);
    assert.equal((await client(agent()).handoffs.refresh({ id: a.id })).status, "completed");
    assert.deepEqual(billing.state.finished, ["cs_attempt_b", "cs_attempt_b"]);

    // Another user taking the step over drops the attempt too.
    billing.state.outcome = "pending";
    const other = await cardAttempt(agent);
    await (
      await returning(other.id, other.state, "cs_other")
    )();
    await louezDb.db
      .insert(louezDb.storeMembers)
      .values({ storeId: STORE, userId: STRANGER, role: "owner" });
    await client(session(STRANGER)).billing.startCardSetup({});
    const reassigned = await handoffs.getHandoffRow(STORE, other.id);
    assert.equal(reassigned.userId, STRANGER);
    assert.equal(reassigned.providerRef, null);
    assert.equal(reassigned.returnStateHash, null);
  });

  test("a return checked before a new click never completes the new attempt", async () => {
    const agent = await apiKey();
    const a = await cardAttempt(agent);
    const finishA = await returning(a.id, a.state, "cs_attempt_a");
    // Click B lands between A's check and A's claim.
    const b = await continueAs(a.token, OWNER);
    assert.ok(b.ok);
    assert.deepEqual(await finishA(), { done: false });
    assert.deepEqual(billing.state.finished, [], "no provider call for a replaced attempt");
    assert.equal((await handoffs.getHandoffRow(STORE, a.id)).status, "opened");

    // Click C lands while A's provider call is in flight (claimed, not finished).
    const c = await cardAttempt(agent);
    const gate = barrier();
    billing.state.gate = gate.wait;
    const finishC = await returning(c.id, c.state, "cs_attempt_c");
    const inFlight = finishC();
    while (billing.state.finished.length === 0)
      await new Promise((resolve) => setImmediate(resolve));
    const d = await continueAs(c.token, OWNER);
    assert.ok(d.ok);
    gate.open();
    billing.state.gate = null;
    assert.deepEqual(await inFlight, { done: false });
    const row = await handoffs.getHandoffRow(STORE, c.id);
    assert.equal(row.status, "opened", "the card of C does not complete D");
    assert.equal(row.providerRef, null);
  });

  test("concurrent returns of one attempt make one provider call; the others read the stored status", async () => {
    const agent = await apiKey();
    const a = await cardAttempt(agent);
    const finishers = await Promise.all(
      Array.from({ length: 20 }, () => returning(a.id, a.state, "cs_concurrent")),
    );
    // The provider is held until every other return has answered: those can
    // only read the stored status, which is not completed yet.
    const gate = barrier();
    billing.state.gate = gate.wait;
    const settled: Array<{ index: number; done: boolean }> = [];
    const returns = finishers.map((finish, index) =>
      finish().then((answer) => {
        settled.push({ index, done: answer.done });
        return answer;
      }),
    );
    for (let tick = 0; settled.length < 19 && tick < 50_000; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(settled.length, 19, "the 19 returns that lost the claim answered");
    assert.ok(
      settled.every((answer) => !answer.done),
      "none of them completed it",
    );
    assert.deepEqual(billing.state.finished, ["cs_concurrent"], "one provider call");
    const held = await handoffs.getHandoffRow(STORE, a.id);
    assert.equal(held.status, "opened");
    assert.equal(held.providerChecks, 1, "one claim took the lease");
    const losers = new Set(settled.map((entry) => entry.index));

    // The claiming return finishes, and it alone completes the handoff.
    gate.open();
    billing.state.gate = null;
    const answers = await Promise.all(returns);
    const winner = answers.findIndex((_, index) => !losers.has(index));
    assert.equal(answers[winner]?.done, true);
    assert.deepEqual(billing.state.finished, ["cs_concurrent"]);
    const completed = await handoffs.getHandoffRow(STORE, a.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.providerChecks, 1, "no claim after it");
    // A reload of a completed return calls nothing.
    assert.deepEqual(await finishers[0]!(), { done: true });
    assert.equal(billing.state.finished.length, 1);
  });

  test("a valid return after the link expired completes it, once per lease", async () => {
    const agent = await apiKey();
    const a = await cardAttempt(agent);
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(orm.eq(louezDb.apiHandoffs.id, a.id));
    billing.state.outcome = "pending";
    const finishers = await Promise.all(
      Array.from({ length: 5 }, () => returning(a.id, a.state, "cs_late")),
    );
    const answers = await Promise.all(finishers.map((finish) => finish()));
    assert.ok(answers.every((answer) => !answer.done));
    assert.deepEqual(billing.state.finished, ["cs_late"], "one claim among concurrent returns");
    // Within the lease, a reload asks nothing; polls never after expiry.
    assert.deepEqual(await finishers[0]!(), { done: false });
    assert.equal((await client(agent()).handoffs.refresh({ id: a.id })).status, "expired");
    assert.equal(billing.state.finished.length, 1);
    // Once the lease ended, the user's return completes it.
    billing.state.outcome = "refreshed";
    await endLease(a.id);
    assert.deepEqual(await finishers[0]!(), { done: true });
    assert.deepEqual(billing.state.finished, ["cs_late", "cs_late"]);
  });

  test("concurrent polls ask the provider once per lease, with backoff, and never after expiry", async () => {
    const agent = await apiKey();
    const a = await cardAttempt(agent);
    billing.state.outcome = "pending";
    await (
      await returning(a.id, a.state, "cs_poll")
    )();
    billing.state.finished.length = 0;
    await endLease(a.id);

    // Twenty polls at once, the provider held at a barrier: one call.
    const gate = barrier();
    billing.state.gate = gate.wait;
    const polls = Array.from({ length: 20 }, () => client(agent()).handoffs.refresh({ id: a.id }));
    while (billing.state.finished.length === 0)
      await new Promise((resolve) => setImmediate(resolve));
    gate.open();
    billing.state.gate = null;
    const answers = await Promise.all(polls);
    assert.ok(answers.every((answer) => answer.status === "opened"));
    assert.deepEqual(billing.state.finished, ["cs_poll"]);

    // Within the lease: the stored status, no call.
    await client(agent()).handoffs.refresh({ id: a.id });
    assert.equal(billing.state.finished.length, 1);

    // The lease grows with each check: 30 s after the return, then 60 s, 120 s…
    const lease = async () => {
      const [row] = await louezDb.db
        .select({
          checks: louezDb.apiHandoffs.providerChecks,
          seconds: orm.sql<number>`TIMESTAMPDIFF(SECOND, NOW(3), ${louezDb.apiHandoffs.providerCheckAt})`,
        })
        .from(louezDb.apiHandoffs)
        .where(orm.eq(louezDb.apiHandoffs.id, a.id));
      return row;
    };
    const second = await lease();
    assert.equal(second?.checks, 2);
    assert.ok(
      Number(second?.seconds) >= 58 && Number(second?.seconds) <= 60,
      String(second?.seconds),
    );
    await endLease(a.id);
    await client(agent()).handoffs.refresh({ id: a.id });
    const third = await lease();
    assert.equal(third?.checks, 3);
    assert.ok(
      Number(third?.seconds) >= 118 && Number(third?.seconds) <= 120,
      String(third?.seconds),
    );

    // Once the link expired, no call at all.
    await endLease(a.id);
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(orm.eq(louezDb.apiHandoffs.id, a.id));
    billing.state.outcome = "refreshed";
    assert.equal((await client(agent()).handoffs.refresh({ id: a.id })).status, "expired");
    assert.equal(billing.state.finished.length, 2);
  });

  test("a refresh whose handoff is gone once the provider confirmed is unknown, never run again", async () => {
    const agent = await apiKey();
    const a = await cardAttempt(agent);
    billing.state.outcome = "pending";
    await (
      await returning(a.id, a.state, "cs_gone")
    )();
    await endLease(a.id);
    billing.state.finished.length = 0;

    // The lease is taken and the provider saves the card; meanwhile the
    // handoff is deleted (the purge, the store's deletion).
    const gate = barrier();
    billing.state.gate = gate.wait;
    billing.state.outcome = "refreshed";
    const context = agent();
    context.headers.set("idempotency-key", "ho-refresh-gone");
    const refreshing = client(context).handoffs.refresh({ id: a.id });
    while (billing.state.finished.length === 0)
      await new Promise((resolve) => setImmediate(resolve));
    await louezDb.db.delete(louezDb.apiHandoffs).where(orm.eq(louezDb.apiHandoffs.id, a.id));
    gate.open();
    billing.state.gate = null;

    let caught: unknown;
    try {
      await refreshing;
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, "the refresh cannot answer");
    assert.notEqual(
      (caught as { data?: { code?: string } }).data?.code,
      "HANDOFF_NOT_FOUND",
      "no refusal: the lease was taken and the provider asked",
    );
    const [operation] = await louezDb.db
      .select({ status: louezDb.apiOperations.status })
      .from(louezDb.apiOperations)
      .where(orm.eq(louezDb.apiOperations.idempotencyKey, "ho-refresh-gone"));
    assert.equal(operation?.status, "unknown");

    const retry = agent();
    retry.headers.set("idempotency-key", "ho-refresh-gone");
    await rejects(client(retry).handoffs.refresh({ id: a.id }), "OPERATION_OUTCOME_UNKNOWN");
    assert.deepEqual(billing.state.finished, ["cs_gone"], "the provider was asked once");
  });

  // --- A revoked connection ------------------------------------------------------

  test("revoking the agent's key ends its handoffs, and its links stop working", async () => {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId: STORE,
      userId: OWNER,
      name: "Revoked agent",
      permissions: agentRights,
    });
    const agent = (): BaseContext => ({
      headers: new Headers({ authorization: `Bearer ${created.key}` }),
      transport: "mcp",
      ports,
      receipt: {},
    });
    const started = await client(agent()).payments.startStripeOnboarding({});
    const token = tokenOf(started.url);
    assert.equal((await handoffs.readHandoffLink(token, OWNER)).ok, true);

    // Revoked another way than the procedure (the link check reads the key itself).
    await louezDb.db
      .update(louezDb.apiKeys)
      .set({ revokedAt: new Date() })
      .where(orm.eq(louezDb.apiKeys.id, created.id));
    const refused = await handoffs.readHandoffLink(token, OWNER);
    assert.equal(!refused.ok && refused.reason, "invalid");

    // Through the procedure: the handoff ends, so the step may be asked for again.
    await louezDb.db
      .update(louezDb.apiKeys)
      .set({ revokedAt: null })
      .where(orm.eq(louezDb.apiKeys.id, created.id));
    const keys = (await import("./api-keys")).dashboardApiKeysRouter;
    await orpc
      .createRouterClient(keys, { context: session(), path: ["dashboard", "apiKeys"] })
      .revoke({ keyId: created.id });
    const row = await handoffs.getHandoffRow(STORE, started.handoff.id);
    assert.equal(row.status, "failed");
    assert.equal(row.failureCode, "connection_revoked");
    assert.equal(row.activeSlot, null);
    const owner = await client(session()).handoffs.get({ id: started.handoff.id });
    assert.match(owner.summary, /revoked/);

    // An OAuth grant that no longer exists opens nothing either.
    const fromGrant = await client(session()).payments.startStripeOnboarding({});
    await louezDb.db
      .update(louezDb.apiHandoffs)
      .set({ credentialKind: "oauth", credentialId: "grant_gone_000000001" })
      .where(orm.eq(louezDb.apiHandoffs.id, fromGrant.handoff.id));
    const gone = await handoffs.readHandoffLink(tokenOf(fromGrant.url), OWNER);
    assert.equal(!gone.ok && gone.reason, "invalid");
  });

  test("a stored refresh answer replays only to a caller who may still settle the step", async () => {
    const agent = await apiKey();
    const attempt = await cardAttempt(agent);
    billing.state.outcome = "pending";
    await (
      await returning(attempt.id, attempt.state, "cs_test_1")
    )();
    await endLease(attempt.id);
    const KEY = "ho-refresh-replay-rights";
    const withKey = () => {
      const context = agent();
      context.headers.set("idempotency-key", KEY);
      return context;
    };
    const first = await client(withKey()).handoffs.refresh({ id: attempt.id });
    assert.deepEqual(await client(withKey()).handoffs.refresh({ id: attempt.id }), first);

    // The connection keeps the right that opens the procedure, and loses the
    // step's domain: its stored answer answers as the step itself does now.
    const narrowed = (billingRight: "none" | "read") =>
      louezDb.db
        .update(louezDb.apiKeys)
        .set({ permissions: { ...agentRights, settings: "write", billing: billingRight } })
        .where(orm.eq(louezDb.apiKeys.storeId, STORE));
    await narrowed("none");
    await rejects(client(agent()).handoffs.refresh({ id: attempt.id }), "HANDOFF_NOT_FOUND");
    await rejects(client(withKey()).handoffs.refresh({ id: attempt.id }), "HANDOFF_NOT_FOUND");
    await narrowed("read");
    await rejects(client(agent()).handoffs.refresh({ id: attempt.id }), "PERMISSION_DENIED");
    await rejects(client(withKey()).handoffs.refresh({ id: attempt.id }), "PERMISSION_DENIED");
  });

  test("a refresh answer stored before views carried url replays with it, and asks the provider nothing", async () => {
    const agent = await apiKey();
    const attempt = await cardAttempt(agent);
    // Back with a card Stripe has not confirmed: its Checkout is on the row.
    billing.state.outcome = "pending";
    await (
      await returning(attempt.id, attempt.state, "cs_test_1")
    )();
    await endLease(attempt.id);
    const KEY = "ho-refresh-before-url";
    const context = agent();
    context.headers.set("idempotency-key", KEY);
    const first = await client(context).handoffs.refresh({ id: attempt.id });
    assert.equal(first.url, `${TEST_APP_URL}/handoffs/${attempt.id}`);

    // The answer as the code before kept it: no url.
    const byKey = orm.eq(louezDb.apiOperations.idempotencyKey, KEY);
    await louezDb.db
      .update(louezDb.apiOperations)
      .set({ result: orm.sql`JSON_REMOVE(${louezDb.apiOperations.result}, '$.url')` })
      .where(byKey);
    const [stored] = await louezDb.db.select().from(louezDb.apiOperations).where(byKey);
    assert.equal(JSON.stringify(stored?.result).includes('"url"'), false, "stored without url");

    // A real run now would ask the provider again: the lease is free, and it would confirm.
    await endLease(attempt.id);
    billing.state.outcome = "refreshed";
    const asked = billing.state.finished.length;
    const replayContext = agent();
    replayContext.headers.set("idempotency-key", KEY);
    const replayed = await client(replayContext).handoffs.refresh({ id: attempt.id });
    assert.equal(replayContext.receipt.replayed, true);
    assert.deepEqual(replayed, first);
    assert.equal(billing.state.finished.length, asked, "the provider was not asked again");
    assert.equal((await handoffs.getHandoffRow(STORE, attempt.id)).status, "opened");
  });

  test("answers stored before views carried decision replay with decision null", async () => {
    const agent = await apiKey();
    const KEY = "ho-start-before-decision";
    const context = agent();
    context.headers.set("idempotency-key", KEY);
    const first = await client(context).payments.startStripeOnboarding({});
    assert.equal(first.handoff.decision, null);

    // The answer as the code before kept it: no decision.
    const byKey = orm.eq(louezDb.apiOperations.idempotencyKey, KEY);
    await louezDb.db
      .update(louezDb.apiOperations)
      .set({
        result: orm.sql`JSON_REMOVE(${louezDb.apiOperations.result}, '$.handoff.decision')`,
      })
      .where(byKey);
    const [stored] = await louezDb.db.select().from(louezDb.apiOperations).where(byKey);
    assert.equal(JSON.stringify(stored?.result).includes('"decision"'), false);

    const replayContext = agent();
    replayContext.headers.set("idempotency-key", KEY);
    const replayed = await client(replayContext).payments.startStripeOnboarding({});
    assert.equal(replayContext.receipt?.replayed, true);
    assert.deepEqual(replayed, first);
  });

  test("an answer that starts a step replays with its idempotency key, and holds no secret", async () => {
    const agent = await apiKey();
    const context = agent();
    context.headers.set("idempotency-key", "ho-replay-1");
    const first = await client(context).payments.startStripeOnboarding({});
    const replayContext = agent();
    replayContext.headers.set("idempotency-key", "ho-replay-1");
    const second = await client(replayContext).payments.startStripeOnboarding({});
    assert.equal(second.url, first.url);
    assert.equal(replayContext.receipt.replayed, true);
    // The replay ran nothing: the step was asked for once.
    assert.equal((await handoffs.getHandoffRow(STORE, first.handoff.id)).revision, 1);

    const [row] = await handoffRows();
    const [operation] = await louezDb.db.select().from(louezDb.apiOperations);
    assert.ok(operation?.result, "the answer is stored for the replay");
    assert.ok(!JSON.stringify(operation).includes(row?.tokenHash ?? "-"), "no hash in the record");
    assert.equal(tokenOf(first.url), first.handoff.id);
  });
});
