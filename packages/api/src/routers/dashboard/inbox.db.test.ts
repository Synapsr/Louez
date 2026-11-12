import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import {
  createTestDatabase,
  raceOnLockedRow,
  skipWithoutTestDatabase,
  type TestDatabase,
} from "@louez/db/testing";

import type { RouterClient } from "@orpc/server";

import type { BaseContext } from "../../context";
import type { InboxItem } from "../../contracts/inbox";
import type { ApiEvent } from "../../platform/ports";

import { createMemoryStorage } from "../../platform/memory-storage";
import { createTestNewStores } from "../../platform/test-new-stores";
import { createTestUrls, TEST_APP_URL } from "../../platform/test-urls";

process.env.AUTH_SECRET ??= "inbox-test-secret";
process.env.NODE_ENV = "test";
// The card gate reads its policy only with the billing service on.
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
          return id ? { user: { id, email: `${id}@ib.test` } } : null;
        },
      },
    },
  },
});

// The inbox end to end through `call()`, on the database: each type of item
// appears, leaves once handled, follows the cursor, and shows only what the
// caller may read.

const OWNER = "ib_owner_user_000001";
const STORE = "ib_store_a_000000001";
const OTHER_STORE = "ib_store_b_000000001";
const CUSTOMER = "ib_customer_00000001";
const OTHER_CUSTOMER = "ib_customer_00000002";
const SETTINGS = {
  reservationMode: "request",
  advanceNoticeMinutes: 0,
  currency: "EUR",
  country: "FR",
  timezone: "Europe/Paris",
  pendingBlocksAvailability: false,
} as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);
const ahead = (ms: number) => new Date(Date.now() + ms);

describe("inbox procedures (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let orpc: typeof import("@orpc/server");
  let orm: typeof import("drizzle-orm");
  let apiKeys: typeof import("../../services/api-keys");
  let inbox: typeof import("../../services/inbox");
  let router: typeof import("./inbox").dashboardInboxRouter;

  const ports = {
    planFeatures: async () => ({ apiAccess: true }),
    runReservationEffects: async () => {},
    insurance: { createContract: async () => null, cancelContract: async () => {} },
    newStores: createTestNewStores(),
    dispatchEffects: () => {},
    storage: createMemoryStorage(),
    urls: createTestUrls(),
    afterCommit: (_event: ApiEvent) => {},
    hostedBy: (): "lumycloud" | null => null,
    log: { error: (event: Record<string, unknown>) => void logged.push(event) },
  };
  /** What the inbox logged through the app's logger (`ApiPorts.log`). */
  const logged: Record<string, unknown>[] = [];

  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${String(++sequence).padStart(12, "0")}`;

  before(async () => {
    database = await createTestDatabase("api_inbox");
    louezDb = await import("@louez/db");
    orpc = await import("@orpc/server");
    orm = await import("drizzle-orm");
    apiKeys = await import("../../services/api-keys");
    inbox = await import("../../services/inbox");
    ({ dashboardInboxRouter: router } = await import("./inbox"));

    await louezDb.db.insert(louezDb.users).values({ id: OWNER, email: "owner@ib.test" });
    await louezDb.db.insert(louezDb.storeMembers).values([
      { storeId: STORE, userId: OWNER, role: "owner" },
      { storeId: OTHER_STORE, userId: OWNER, role: "owner" },
    ]);
    await louezDb.db.insert(louezDb.customers).values([
      {
        id: CUSTOMER,
        storeId: STORE,
        email: "ada@ib.test",
        firstName: "Ada",
        lastName: "Lovelace",
      },
      {
        id: OTHER_CUSTOMER,
        storeId: OTHER_STORE,
        email: "grace@ib.test",
        firstName: "Grace",
        lastName: "Hopper",
      },
    ]);
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    logged.length = 0;
    const { db } = louezDb;
    for (const table of [
      louezDb.inboxAcknowledgements,
      louezDb.apiOperations,
      louezDb.apiJobs,
      louezDb.apiEffects,
      louezDb.apiKeys,
      louezDb.billingPolicies,
      louezDb.billingSyncQueue,
      louezDb.paymentDisputes,
      louezDb.payments,
      louezDb.invoices,
      louezDb.receivedInvoices,
      louezDb.storeIntegrations,
      louezDb.reservationActivity,
      louezDb.reservationItemUnits,
      louezDb.reservationItems,
      louezDb.reservations,
      louezDb.productUnitDowntimes,
      louezDb.productUnits,
      louezDb.products,
      louezDb.stores,
    ]) {
      await db.delete(table);
    }
    await db.insert(louezDb.stores).values([
      {
        id: STORE,
        userId: OWNER,
        name: "Brest Surf",
        slug: "ib-brest-surf",
        settings: SETTINGS,
        onboardingCompleted: true,
        createdAt: ago(30 * DAY),
      },
      {
        id: OTHER_STORE,
        userId: OWNER,
        name: "Other",
        slug: "ib-other",
        settings: SETTINGS,
        onboardingCompleted: true,
        createdAt: ago(30 * DAY),
      },
    ]);
  });

  // --- Callers --------------------------------------------------------------

  function session(store = STORE) {
    return {
      headers: new Headers({ [SESSION_HEADER]: OWNER, cookie: `louez_active_store=${store}` }),
      transport: "rpc" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    };
  }

  type Permissions = Parameters<typeof apiKeys.createApiKey>[0]["permissions"];
  const everything: Permissions = {
    reservations: "write",
    products: "read",
    customers: "read",
    categories: "read",
    payments: "write",
    analytics: "read",
    settings: "read",
    integrations: "read",
  };
  const none: Permissions = {
    reservations: "none",
    products: "none",
    customers: "none",
    categories: "none",
    payments: "none",
    analytics: "none",
    settings: "none",
  };

  async function apiKey(permissions: Permissions = everything, storeId = STORE) {
    const created = await apiKeys.createApiKey({
      db: louezDb.db,
      storeId,
      userId: OWNER,
      name: "Inbox agent",
      permissions,
    });
    const context = () => ({
      headers: new Headers({ authorization: `Bearer ${created.key}` }),
      transport: "mcp" as const,
      ports,
      receipt: {} as { operationId?: string; replayed?: boolean },
    });
    return Object.assign(context, { id: created.id });
  }

  type Router = typeof router;
  type Client = RouterClient<Router>;

  function run<K extends keyof Router>(
    name: K,
    input: Parameters<Client[K]>[0],
    context: BaseContext,
  ): ReturnType<Client[K]> {
    const client = orpc.createRouterClient(router, {
      context,
      path: ["dashboard", "inbox"],
    }) as Client;
    const call = client[name] as (input: Parameters<Client[K]>[0]) => ReturnType<Client[K]>;
    return call(input);
  }

  const list = (
    context: BaseContext = session(),
    input: { cursor?: string; limit?: number } = {},
  ) => run("list", input, context);

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

  const ofType = (items: InboxItem[], type: InboxItem["type"]) =>
    items.filter((item) => item.type === type);

  // --- Fixtures -------------------------------------------------------------

  async function reservation(
    status: "pending" | "confirmed" | "ongoing" | "completed" | "cancelled" | "quote",
    options: {
      store?: string;
      start?: Date;
      end?: Date;
      createdAt?: Date;
      source?: string;
      billableAt?: Date;
      pickedUpAt?: Date;
      depositStatus?: "authorized" | "failed" | "released";
      depositExpiresAt?: Date;
    } = {},
  ) {
    const id = nextId("ib_res");
    const store = options.store ?? STORE;
    // A fixture, so it may start in any status.
    await louezDb.db.insert(louezDb.reservations).values({
      id,
      storeId: store,
      customerId: store === STORE ? CUSTOMER : OTHER_CUSTOMER,
      number: `R-${sequence}`,
      status,
      startDate: options.start ?? ahead(2 * DAY),
      endDate: options.end ?? ahead(4 * DAY),
      subtotalAmount: "20.00",
      depositAmount: "300.00",
      totalAmount: "320.00",
      currency: "EUR",
      source: options.source ?? "online",
      createdAt: options.createdAt ?? ago(HOUR),
      updatedAt: options.createdAt ?? ago(HOUR),
      billableAt: options.billableAt ?? null,
      pickedUpAt: options.pickedUpAt ?? null,
      depositStatus: options.depositStatus ?? "pending",
      depositAuthorizationExpiresAt: options.depositExpiresAt ?? null,
    });
    return id;
  }

  async function activity(
    reservationId: string,
    activityType:
      | "payment_failed"
      | "deposit_failed"
      | "payment_received"
      | "payment_added"
      | "note_updated"
      | "created"
      | "modified",
    metadata: Record<string, unknown>,
    createdAt: Date,
  ) {
    const id = nextId("ib_act");
    await louezDb.db
      .insert(louezDb.reservationActivity)
      .values({ id, reservationId, activityType, metadata, createdAt });
    return id;
  }

  async function payment(
    reservationId: string,
    values: {
      type: "rental" | "deposit_return";
      method: "cash" | "stripe";
      status: "pending" | "completed";
      createdAt?: Date;
      paidAt?: Date;
    },
  ) {
    await louezDb.db.insert(louezDb.payments).values({
      id: nextId("ib_pay"),
      reservationId,
      amount: "20.00",
      type: values.type,
      method: values.method,
      status: values.status,
      ...(values.createdAt ? { createdAt: values.createdAt } : {}),
      ...(values.paidAt ? { paidAt: values.paidAt } : {}),
    });
  }

  async function setStatus(
    id: string,
    status: "confirmed" | "ongoing" | "completed" | "cancelled",
  ) {
    // A fixture: the status change itself is the reservations procedures' business.
    await louezDb.db
      .update(louezDb.reservations)
      .set({ status })
      .where(orm.eq(louezDb.reservations.id, id));
  }

  // --- Item types -----------------------------------------------------------

  test("a booking request shows until it is answered; a checkout waiting for its payment and a marketplace hold do not", async () => {
    const request = await reservation("pending");
    const checkout = await reservation("pending");
    await louezDb.db.insert(louezDb.payments).values({
      id: nextId("ib_pay"),
      reservationId: checkout,
      amount: "20.00",
      type: "rental",
      method: "stripe",
      status: "pending",
      stripeCheckoutSessionId: "cs_test_1",
    });
    await reservation("pending", { source: "marketplace" });
    await reservation("pending", { store: OTHER_STORE });

    const { items } = await list();
    const requests = ofType(items, "booking_request");
    assert.deepEqual(
      requests.map((item) => item.reservation?.id),
      [request],
    );
    const [item] = requests;
    assert.equal(item?.id, `booking_request:${request}`);
    assert.equal(item?.severity, "warning");
    assert.equal(item?.reservation?.customerName, "Ada Lovelace");
    assert.match(item?.summary ?? "", /waits for your answer/);
    assert.deepEqual(item?.tools, ["reservations_get", "reservations_update_status"]);
    assert.equal(
      item?.links.dashboard,
      `${TEST_APP_URL}/dashboard/reservations/${request}?store=${STORE}`,
    );

    await setStatus(request, "confirmed");
    assert.equal(ofType((await list()).items, "booking_request").length, 0);
  });

  test("a late pickup and a late return show until the reservation moves on", async () => {
    const pickup = await reservation("confirmed", {
      start: ago(3 * HOUR),
      end: ahead(DAY),
      billableAt: ago(2 * DAY),
      createdAt: ago(2 * DAY),
    });
    const late = await reservation("ongoing", {
      start: ago(5 * DAY),
      end: ago(2 * DAY + HOUR),
      pickedUpAt: ago(5 * DAY),
      createdAt: ago(6 * DAY),
    });
    const justLate = await reservation("ongoing", {
      start: ago(DAY),
      end: ago(2 * HOUR),
      pickedUpAt: ago(DAY),
      createdAt: ago(2 * DAY),
    });
    // On time, and a pickup on a rental that ended long ago (stale bookkeeping).
    await reservation("ongoing", { start: ago(DAY), end: ahead(DAY), pickedUpAt: ago(DAY) });
    await reservation("confirmed", { start: ago(50 * DAY), end: ago(45 * DAY) });

    const { items } = await list();
    const pickups = ofType(items, "pickup_overdue");
    assert.deepEqual(
      pickups.map((item) => item.reservation?.id),
      [pickup],
    );
    // Late from its start: it was confirmed before.
    assert.ok(Math.abs((pickups[0]?.occurredAt.getTime() ?? 0) - ago(3 * HOUR).getTime()) < 5_000);
    const returns = ofType(items, "return_overdue");
    assert.deepEqual(
      returns.map((item) => [item.reservation?.id, item.severity]),
      [
        [late, "critical"],
        [justLate, "warning"],
      ],
    );
    // A day begun counts, as reservations_list_overdue counts it.
    assert.equal(returns[0]?.details.daysLate, 3);

    await setStatus(pickup, "ongoing");
    await setStatus(late, "completed");
    const after = await list();
    assert.equal(ofType(after.items, "pickup_overdue").length, 0);
    assert.deepEqual(
      ofType(after.items, "return_overdue").map((item) => item.reservation?.id),
      [justLate],
    );
  });

  test("a return-date request shows while pending, with the customer's reason only to who may read customers", async () => {
    const id = await reservation("ongoing", {
      start: ago(DAY),
      end: ahead(DAY),
      pickedUpAt: ago(DAY),
    });
    const requestId = await activity(
      id,
      "note_updated",
      {
        kind: "return_date_request",
        status: "pending",
        originalStartDate: ago(DAY).toISOString(),
        originalEndDate: ahead(DAY).toISOString(),
        requestedEndDate: ahead(3 * DAY).toISOString(),
        reason: "Ada wants two more days",
      },
      ago(HOUR),
    );

    const [item] = ofType((await list()).items, "date_change_request");
    assert.equal(item?.id, `date_change_request:${requestId}`);
    assert.equal(item?.details.reason, "Ada wants two more days");

    const noCustomers = await apiKey({ ...everything, customers: "none" });
    const [redacted] = ofType((await list(noCustomers())).items, "date_change_request");
    assert.equal(redacted?.details.reason, null);
    assert.equal(redacted?.reservation?.customerName, null);
    assert.doesNotMatch(redacted?.summary ?? "", /Ada/);

    await louezDb.db
      .update(louezDb.reservationActivity)
      .set({
        metadata: {
          kind: "return_date_request",
          status: "rejected",
          reviewedAt: ago(0).toISOString(),
        },
      })
      .where(orm.eq(louezDb.reservationActivity.id, requestId));
    assert.equal(ofType((await list()).items, "date_change_request").length, 0);
  });

  test("a deposit hold shows two days before it expires, critical once expired, and leaves once released", async () => {
    const soon = await reservation("confirmed", {
      depositStatus: "authorized",
      depositExpiresAt: ahead(DAY),
    });
    const expired = await reservation("ongoing", {
      start: ago(8 * DAY),
      pickedUpAt: ago(8 * DAY),
      depositStatus: "authorized",
      depositExpiresAt: ago(HOUR),
    });
    await reservation("confirmed", {
      depositStatus: "authorized",
      depositExpiresAt: ahead(5 * DAY),
    });

    const items = ofType((await list()).items, "deposit_expiring");
    assert.deepEqual(
      items.map((item) => [item.reservation?.id, item.severity]).sort(),
      [
        [expired, "critical"],
        [soon, "warning"],
      ].sort(),
    );
    assert.match(items.find((item) => item.reservation?.id === soon)?.summary ?? "", /300\.00 EUR/);

    await louezDb.db
      .update(louezDb.reservations)
      .set({ depositStatus: "released" })
      .where(orm.eq(louezDb.reservations.id, soon));
    assert.deepEqual(
      ofType((await list()).items, "deposit_expiring").map((item) => item.reservation?.id),
      [expired],
    );
  });

  test("a deposit hold Stripe has not confirmed shows after 15 minutes, whatever its age, until it is settled", async () => {
    const attempt = async (
      reservationId: string,
      createdAt: Date,
      status: "pending" | "failed" = "pending",
    ) => {
      const id = nextId("ib_pay");
      await louezDb.db.insert(louezDb.payments).values({
        id,
        reservationId,
        amount: "300.00",
        type: "deposit_hold",
        method: "stripe",
        status,
        currency: "EUR",
        createdAt,
        updatedAt: createdAt,
      });
      return id;
    };
    const waiting = await attempt(await reservation("confirmed"), ago(HOUR));
    // No age removes it, nor does the end of the rental: the card may be held.
    const old = await attempt(await reservation("completed"), ago(40 * DAY));
    // Five minutes old: its webhook may still settle it.
    await attempt(await reservation("confirmed"), ago(5 * 60_000));
    // Refused by Stripe: settled, as failed.
    await attempt(await reservation("confirmed"), ago(HOUR), "failed");

    const items = ofType((await list()).items, "deposit_unconfirmed");
    assert.deepEqual(
      items.map((item) => item.id).sort(),
      [`deposit_unconfirmed:${old}`, `deposit_unconfirmed:${waiting}`].sort(),
    );
    const item = items.find((entry) => entry.id === `deposit_unconfirmed:${waiting}`);
    assert.equal(item?.severity, "warning");
    assert.match(item?.summary ?? "", /300\.00 EUR/);
    assert.match(item?.summary ?? "", /never a second one/);

    // Stripe confirms it: the attempt's row becomes the hold.
    await louezDb.db
      .update(louezDb.payments)
      .set({ status: "authorized", stripePaymentIntentId: "pi_confirmed" })
      .where(orm.eq(louezDb.payments.id, waiting));
    assert.deepEqual(
      ofType((await list()).items, "deposit_unconfirmed").map((entry) => entry.id),
      [`deposit_unconfirmed:${old}`],
    );
  });

  test("a second deposit hold shows while its release is owed, whatever became of the outbox row", async () => {
    const owed = async (paymentIntentId: string, since: Date) => {
      const reservationId = await reservation("confirmed", { depositStatus: "authorized" });
      const id = nextId("ib_pay");
      await louezDb.db.insert(louezDb.payments).values({
        id,
        reservationId,
        amount: "300.00",
        type: "deposit_hold",
        method: "stripe",
        status: "authorized",
        stripePaymentIntentId: paymentIntentId,
        stripeAccountId: "acct_inbox",
        releaseOwedAt: since,
        currency: "EUR",
      });
      return { reservationId, paymentId: id, paymentIntentId };
    };
    const release = async (
      hold: Awaited<ReturnType<typeof owed>>,
      status: "abandoned" | "failed",
    ) => {
      await louezDb.db.insert(louezDb.apiEffects).values({
        id: nextId("ib_eff"),
        storeId: STORE,
        type: "deposit.holdRelease",
        payload: { ...hold, accountId: "acct_inbox" },
        status,
        attempts: status === "abandoned" ? 8 : 2,
        nextAttemptAt: ago(HOUR),
        createdAt: ago(3 * HOUR),
      });
    };
    // Its outbox row abandoned, still being tried, or deleted by the retention: the
    // debt is what counts.
    const abandoned = await owed("pi_second_abandoned", ago(3 * HOUR));
    await release(abandoned, "abandoned");
    const trying = await owed("pi_second_trying", ago(3 * HOUR));
    await release(trying, "failed");
    const pruned = await owed("pi_second_pruned", ago(40 * DAY));
    // Owed a few minutes ago: the outbox's first tries may still release it.
    await owed("pi_second_recent", ago(5 * 60_000));

    const items = ofType((await list()).items, "deposit_release_failed");
    assert.deepEqual(
      items.map((item) => item.id).sort(),
      [abandoned, trying, pruned].map((hold) => `deposit_release_failed:${hold.paymentId}`).sort(),
    );
    const item = items.find(
      (entry) => entry.id === `deposit_release_failed:${abandoned.paymentId}`,
    );
    assert.equal(item?.severity, "warning");
    assert.equal(item?.reservation?.id, abandoned.reservationId);
    assert.match(item?.summary ?? "", /has not confirmed the release/);
    assert.doesNotMatch(item?.summary ?? "", /held twice/);
    assert.match(item?.summary ?? "", /pi_second_abandoned/);

    // Stripe says the authorization is cancelled: nothing is owed any more.
    await louezDb.db
      .update(louezDb.payments)
      .set({ status: "cancelled", releaseOwedAt: null })
      .where(orm.eq(louezDb.payments.id, abandoned.paymentId));
    assert.deepEqual(
      ofType((await list()).items, "deposit_release_failed")
        .map((entry) => entry.id)
        .sort(),
      [trying, pruned].map((hold) => `deposit_release_failed:${hold.paymentId}`).sort(),
    );
  });

  test("a failed payment shows once per reservation, until a payment comes in; a failed deposit while it stays failed", async () => {
    const id = await reservation("confirmed");
    await activity(
      id,
      "payment_failed",
      { amount: 20, currency: "EUR", error: "Declined" },
      ago(3 * HOUR),
    );
    const latest = await activity(
      id,
      "payment_failed",
      {
        amount: 20,
        currency: "EUR",
        error: "Insufficient funds",
        declineCode: "insufficient_funds",
      },
      ago(2 * HOUR),
    );
    const deposit = await reservation("confirmed", { depositStatus: "failed" });
    const depositFailure = await activity(deposit, "deposit_failed", { amount: 300 }, ago(HOUR));
    // A failure on a cancelled reservation, and one from long ago.
    const cancelled = await reservation("cancelled");
    await activity(cancelled, "payment_failed", { amount: 5 }, ago(HOUR));
    const old = await reservation("confirmed");
    await activity(old, "payment_failed", { amount: 5 }, ago(40 * DAY));

    const failures = ofType((await list()).items, "payment_failed");
    assert.deepEqual(
      failures.map((item) => item.id),
      [`payment_failed:${latest}`, `payment_failed:${depositFailure}`],
    );
    assert.equal(failures[0]?.details.amount, "20.00");
    assert.equal(failures[0]?.details.reason, "Insufficient funds");
    assert.deepEqual(failures[0]?.tools, ["reservations_get", "record_payment"]);
    assert.equal(failures[1]?.details.kind, "deposit");

    // A payment link sent, and a deposit given back, are not money received.
    await activity(id, "payment_added", { isPaymentRequest: true, amount: 20 }, ago(HOUR));
    await payment(id, { type: "deposit_return", method: "cash", status: "completed" });
    await payment(id, { type: "rental", method: "stripe", status: "pending" });
    assert.equal(ofType((await list()).items, "payment_failed").length, 2);

    // A rental payment completed after the failure is.
    await payment(id, { type: "rental", method: "cash", status: "completed" });
    await louezDb.db
      .update(louezDb.reservations)
      .set({ depositStatus: "authorized" })
      .where(orm.eq(louezDb.reservations.id, deposit));
    assert.equal(ofType((await list()).items, "payment_failed").length, 0);
  });

  test("a rental payment completed before the failure does not clear it", async () => {
    const id = await reservation("confirmed");
    await payment(id, {
      type: "rental",
      method: "cash",
      status: "completed",
      createdAt: ago(3 * HOUR),
      paidAt: ago(3 * HOUR),
    });
    await activity(id, "payment_failed", { amount: 20 }, ago(2 * HOUR));
    assert.equal(ofType((await list()).items, "payment_failed").length, 1);
  });

  test("an open dispute shows, critical while it needs an answer, and leaves once closed", async () => {
    const id = await reservation("completed");
    await louezDb.db.insert(louezDb.paymentDisputes).values({
      id: "dp_test_000000000001",
      paymentId: nextId("ib_pay"),
      reservationId: id,
      amountMinor: 12_345,
      currency: "eur",
      status: "open",
      stripeStatus: "needs_response",
      openedAt: ago(2 * DAY),
      createdAt: ago(HOUR),
    });

    const [item] = ofType((await list()).items, "dispute_open");
    assert.equal(item?.id, "dispute_open:dp_test_000000000001");
    assert.equal(item?.severity, "critical");
    // Shown from when the webhook wrote it; Stripe's date is a fact.
    assert.ok(Math.abs((item?.occurredAt.getTime() ?? 0) - ago(HOUR).getTime()) < 5_000);
    assert.equal(
      new Date(String(item?.details.openedAt)).getTime() <= ago(2 * DAY - 5_000).getTime(),
      true,
    );
    assert.equal(item?.details.amount, "123.45");
    assert.match(item?.summary ?? "", /123\.45 EUR/);

    await louezDb.db
      .update(louezDb.paymentDisputes)
      .set({ status: "won", stripeStatus: "won" })
      .where(orm.eq(louezDb.paymentDisputes.id, "dp_test_000000000001"));
    assert.equal(ofType((await list()).items, "dispute_open").length, 0);
  });

  async function bookedUnit(
    booking: { status?: "confirmed" | "ongoing"; start?: Date; end?: Date } = {},
  ) {
    const productId = nextId("ib_prd");
    await louezDb.db.insert(louezDb.products).values({
      id: productId,
      storeId: STORE,
      name: "Kayak",
      price: "10.00",
      pricingMode: "day",
    });
    const unitId = nextId("ib_unt");
    await louezDb.db.insert(louezDb.productUnits).values({
      id: unitId,
      productId,
      identifier: "K-01",
      createdAt: ago(10 * DAY),
      updatedAt: ago(10 * DAY),
    });
    const reservationId = await reservation(booking.status ?? "confirmed", {
      start: booking.start ?? ahead(DAY),
      end: booking.end ?? ahead(3 * DAY),
      ...(booking.status === "ongoing" ? { pickedUpAt: booking.start ?? ago(DAY) } : {}),
    });
    const itemId = nextId("ib_itm");
    await louezDb.db.insert(louezDb.reservationItems).values({
      id: itemId,
      reservationId,
      productId,
      quantity: 1,
      unitPrice: "10.00",
      depositPerUnit: "0.00",
      totalPrice: "20.00",
      productSnapshot: { name: "Kayak", description: null, images: [] },
    });
    const assignmentId = nextId("ib_asg");
    await louezDb.db.insert(louezDb.reservationItemUnits).values({
      id: assignmentId,
      reservationItemId: itemId,
      productUnitId: unitId,
      identifierSnapshot: "K-01",
      assignedAt: ago(2 * DAY),
    });
    return { productId, unitId, reservationId, assignmentId };
  }

  test("a booking on a unit out of service over its dates, or retired, shows until the unit is free", async () => {
    const booked = await bookedUnit();
    const downtimeId = nextId("ib_dwn");
    await louezDb.db.insert(louezDb.productUnitDowntimes).values({
      id: downtimeId,
      productUnitId: booked.unitId,
      storeId: STORE,
      reason: "repair",
      startsAt: ago(HOUR),
      endsAt: ahead(2 * DAY),
      createdAt: ago(HOUR),
      updatedAt: ago(HOUR),
    });

    const [item] = ofType((await list()).items, "unit_conflict");
    assert.equal(item?.id, `unit_conflict:${booked.assignmentId}`);
    assert.equal(item?.details.reason, "downtime");
    assert.equal(item?.details.unitIdentifier, "K-01");
    assert.ok(item?.tools.includes("products_update_downtime"));

    // The downtime ends before the booking starts: no conflict.
    await louezDb.db
      .update(louezDb.productUnitDowntimes)
      .set({ endsAt: ahead(HOUR) })
      .where(orm.eq(louezDb.productUnitDowntimes.id, downtimeId));
    assert.equal(ofType((await list()).items, "unit_conflict").length, 0);

    await louezDb.db
      .update(louezDb.productUnits)
      .set({ lifecycleStatus: "retired", retiredAt: ago(HOUR), updatedAt: ago(HOUR) })
      .where(orm.eq(louezDb.productUnits.id, booked.unitId));
    const [retired] = ofType((await list()).items, "unit_conflict");
    assert.equal(retired?.details.reason, "retired");

    // Without products, the item is not shown.
    const noProducts = await apiKey({ ...everything, products: "none" });
    assert.equal(ofType((await list(noProducts())).items, "unit_conflict").length, 0);
  });

  test("a unit conflict counts the store's turnover buffer, as the product page does", async () => {
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings: { ...SETTINGS, turnoverBufferMinutes: 30 } })
      .where(orm.eq(louezDb.stores.id, STORE));
    const booked = await bookedUnit();
    const [booking] = await louezDb.db
      .select({ endDate: louezDb.reservations.endDate })
      .from(louezDb.reservations)
      .where(orm.eq(louezDb.reservations.id, booked.reservationId));
    assert.ok(booking);
    // A downtime that starts 15 minutes after the booking ends.
    await louezDb.db.insert(louezDb.productUnitDowntimes).values({
      id: nextId("ib_dwn"),
      productUnitId: booked.unitId,
      storeId: STORE,
      reason: "maintenance",
      startsAt: new Date(booking.endDate.getTime() + 15 * 60_000),
      endsAt: new Date(booking.endDate.getTime() + 2 * HOUR),
      createdAt: ago(HOUR),
      updatedAt: ago(HOUR),
    });

    const { getUnitConflictFlags, loadStoreUnitWindows } =
      await import("../../services/unit-conflicts");
    const windows = await loadStoreUnitWindows(STORE, new Date());
    const flags = await getUnitConflictFlags(windows, {
      storeId: STORE,
      pendingBlocksAvailability: false,
      turnoverBufferMinutes: 30,
    });
    assert.equal(flags[booked.unitId], true, "the product page flags it");
    const [item] = ofType((await list()).items, "unit_conflict");
    assert.equal(item?.id, `unit_conflict:${booked.assignmentId}`);

    // Without the buffer, there is no conflict.
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings: SETTINGS })
      .where(orm.eq(louezDb.stores.id, STORE));
    assert.equal(ofType((await list()).items, "unit_conflict").length, 0);
  });

  test("a note does not bring back an acknowledged late pickup, late return or unit conflict; a schedule change does", async () => {
    const pickup = await reservation("confirmed", {
      start: ago(3 * HOUR),
      end: ahead(DAY),
      createdAt: ago(2 * DAY),
    });
    const late = await reservation("ongoing", {
      start: ago(3 * DAY),
      end: ago(DAY),
      pickedUpAt: ago(3 * DAY),
      createdAt: ago(4 * DAY),
    });
    const booked = await bookedUnit();
    await louezDb.db.insert(louezDb.productUnitDowntimes).values({
      id: nextId("ib_dwn"),
      productUnitId: booked.unitId,
      storeId: STORE,
      reason: "repair",
      startsAt: ago(HOUR),
      endsAt: ahead(2 * DAY),
      createdAt: ago(HOUR),
      updatedAt: ago(HOUR),
    });
    const watched = ["pickup_overdue", "return_overdue", "unit_conflict"] as const;
    const items = (await list()).items.filter((entry) =>
      (watched as readonly string[]).includes(entry.type),
    );
    assert.equal(items.length, 3);
    await run(
      "acknowledge",
      { items: items.map((entry) => ({ id: entry.id, occurredAt: entry.occurredAt })) },
      session(),
    );

    const { updateReservationNotes } = await import("../../services/reservations");
    const caller = {
      storeId: STORE,
      store: { id: STORE, name: "Brest Surf", slug: "ib-brest-surf", ownerUserId: OWNER },
      transport: "mcp" as const,
      ports,
    };
    for (const id of [pickup, late, booked.reservationId]) {
      await updateReservationNotes(caller, { id, notes: "Customer called" });
    }
    // The notes were written (updatedAt moved), and nothing came back.
    const [written] = await louezDb.db
      .select({ updatedAt: louezDb.reservations.updatedAt })
      .from(louezDb.reservations)
      .where(orm.eq(louezDb.reservations.id, late));
    assert.ok((written?.updatedAt.getTime() ?? 0) > ago(60_000).getTime());
    assert.deepEqual(
      (await list()).items.filter((entry) => (watched as readonly string[]).includes(entry.type)),
      [],
    );

    // Its end moved earlier by an edit: the late return is new again.
    await louezDb.db
      .update(louezDb.reservations)
      .set({ endDate: ago(2 * DAY), scheduleChangedAt: ago(10 * 60_000) })
      .where(orm.eq(louezDb.reservations.id, late));
    const [back] = ofType((await list()).items, "return_overdue");
    assert.equal(back?.id, `return_overdue:${late}`);
  });

  test("raising the turnover buffer dates the conflicts it makes from the change", async () => {
    const reader = async () => ({
      store: await storeRow(),
      urls: ports.urls,
      hostedBy: null,
      reads: { reservations: true, customers: true, products: true },
      operationsOf: null,
    });
    // One conflict without any buffer, one only with a 30-minute buffer.
    const plain = await bookedUnit();
    await louezDb.db.insert(louezDb.productUnitDowntimes).values({
      id: nextId("ib_dwn"),
      productUnitId: plain.unitId,
      storeId: STORE,
      reason: "repair",
      startsAt: ago(HOUR),
      endsAt: ahead(2 * DAY),
      createdAt: ago(HOUR),
      updatedAt: ago(HOUR),
    });
    const buffered = await bookedUnit();
    const [booking] = await louezDb.db
      .select({ endDate: louezDb.reservations.endDate })
      .from(louezDb.reservations)
      .where(orm.eq(louezDb.reservations.id, buffered.reservationId));
    assert.ok(booking);
    await louezDb.db.insert(louezDb.productUnitDowntimes).values({
      id: nextId("ib_dwn"),
      productUnitId: buffered.unitId,
      storeId: STORE,
      reason: "maintenance",
      startsAt: new Date(booking.endDate.getTime() + 15 * 60_000),
      endsAt: new Date(booking.endDate.getTime() + 2 * HOUR),
      createdAt: ago(HOUR),
      updatedAt: ago(HOUR),
    });
    const earlier = await inbox.listInbox(await reader(), {}, { now: ago(10 * 60_000) });
    assert.deepEqual(
      ofType(earlier.items, "unit_conflict").map((entry) => entry.id),
      [`unit_conflict:${plain.assignmentId}`],
    );

    const { updateReservationRules } = await import("../../services/settings");
    const actor = {
      storeId: STORE,
      store: { id: STORE, name: "Brest Surf", slug: "ib-brest-surf", ownerUserId: OWNER },
      afterCommit: () => {},
    };
    await updateReservationRules(actor, { turnoverBufferMinutes: 30 });
    const changedAt = (await storeRow()).availabilityRulesChangedAt;
    assert.ok(changedAt && changedAt.getTime() > ago(60_000).getTime());

    // Read a minute on, past the hold-back: only the conflict the buffer made is new.
    const next = await inbox.listInbox(
      await reader(),
      { cursor: earlier.nextCursor },
      { now: ahead(60_000) },
    );
    assert.deepEqual(
      ofType(next.items, "unit_conflict").map((entry) => entry.id),
      [`unit_conflict:${buffered.assignmentId}`],
    );

    // The same buffer again changes nothing.
    await updateReservationRules(actor, { turnoverBufferMinutes: 30, minRentalMinutes: 30 });
    assert.equal((await storeRow()).availabilityRulesChangedAt?.getTime(), changedAt.getTime());
  });

  test("a retired unit conflicts with a booking that ended within the buffer, as on the product page", async () => {
    await louezDb.db
      .update(louezDb.stores)
      .set({ settings: { ...SETTINGS, turnoverBufferMinutes: 30 } })
      .where(orm.eq(louezDb.stores.id, STORE));
    const booked = await bookedUnit({
      status: "ongoing",
      start: ago(DAY),
      end: ago(15 * 60_000),
    });
    await louezDb.db
      .update(louezDb.productUnits)
      .set({ lifecycleStatus: "retired", retiredAt: ago(HOUR), updatedAt: ago(HOUR) })
      .where(orm.eq(louezDb.productUnits.id, booked.unitId));

    const { getUnitConflictFlags, unitConflictWindows } =
      await import("../../services/unit-conflicts");
    const units = await louezDb.db
      .select()
      .from(louezDb.productUnits)
      .where(orm.eq(louezDb.productUnits.id, booked.unitId));
    const flags = await getUnitConflictFlags(unitConflictWindows(units, [], new Date()), {
      storeId: STORE,
      pendingBlocksAvailability: false,
      turnoverBufferMinutes: 30,
    });
    assert.equal(flags[booked.unitId], true, "the product page flags it");
    const [item] = ofType((await list()).items, "unit_conflict");
    assert.equal(item?.id, `unit_conflict:${booked.assignmentId}`);
    assert.equal(item?.details.reason, "retired");
  });

  test("a booking created over the stock shows until it ends", async () => {
    const id = await reservation("confirmed");
    await activity(
      id,
      "created",
      {
        source: "manual",
        overbooked: true,
        overbookingShortfalls: [{ productId: "p", requested: 2, available: 1 }],
      },
      ago(HOUR),
    );
    const fine = await reservation("confirmed");
    await activity(fine, "created", { source: "manual" }, ago(HOUR));

    const items = ofType((await list()).items, "overbooking");
    assert.deepEqual(
      items.map((item) => item.reservation?.id),
      [id],
    );
    assert.equal(items[0]?.details.productsShort, 1);
    await setStatus(id, "cancelled");
    assert.equal(ofType((await list()).items, "overbooking").length, 0);
  });

  test("an edit forced over the stock shows, until a later edit fits", async () => {
    const shortfalls = [{ productId: "p", requested: 3, available: 2 }];
    const id = await reservation("confirmed");
    await activity(id, "created", { source: "manual" }, ago(3 * HOUR));
    await activity(
      id,
      "modified",
      { overbooked: true, overbookingShortfalls: shortfalls },
      ago(2 * HOUR),
    );
    // An edit that changes no stock carries no verdict: the item stays.
    await activity(id, "modified", { difference: 0 }, ago(90 * 60_000));

    const forced = ofType((await list()).items, "overbooking");
    assert.deepEqual(
      forced.map((item) => [item.reservation?.id, item.details.productsShort]),
      [[id, 1]],
    );
    assert.ok(Math.abs((forced[0]?.occurredAt.getTime() ?? 0) - ago(2 * HOUR).getTime()) < 5_000);

    await activity(id, "modified", { overbooked: false }, ago(HOUR));
    assert.equal(ofType((await list()).items, "overbooking").length, 0);
  });

  test("a booking overbooked twice is one item, dated from its latest verdict", async () => {
    const id = await reservation("confirmed");
    await activity(id, "created", { source: "manual", overbooked: true }, ago(3 * HOUR));
    await activity(id, "modified", { overbooked: false }, ago(2 * HOUR));
    await activity(
      id,
      "modified",
      { overbooked: true, overbookingShortfalls: [{ productId: "p" }, { productId: "q" }] },
      ago(HOUR),
    );

    const items = ofType((await list()).items, "overbooking");
    assert.deepEqual(
      items.map((item) => [item.id, item.details.productsShort]),
      [[`overbooking:${id}`, 2]],
    );
    assert.ok(Math.abs((items[0]?.occurredAt.getTime() ?? 0) - ago(HOUR).getTime()) < 5_000);
  });

  test("a supplier invoice shows until it is handled, to who may read integrations", async () => {
    await louezDb.db.insert(louezDb.storeIntegrations).values({
      id: nextId("ib_int"),
      storeId: STORE,
      providerKey: "superpdp",
      category: "invoicing",
      enabled: true,
      status: "active",
    });
    const invoiceId = nextId("ib_rin");
    await louezDb.db.insert(louezDb.receivedInvoices).values({
      id: invoiceId,
      storeId: STORE,
      superPdpInvoiceId: "spdp_1",
      sellerName: "Wetsuit Supply",
      sellerIdentifier: "12345678900011",
      number: "F-2026-001",
      issueDate: "2026-11-01",
      totalExclTax: "100.00",
      totalTax: "20.00",
      totalInclTax: "120.00",
      currency: "EUR",
      latestStatus: "fr:200",
      createdAt: ago(HOUR),
      updatedAt: ago(HOUR),
    });

    const [item] = ofType((await list()).items, "supplier_invoice");
    assert.equal(item?.id, `supplier_invoice:${invoiceId}`);
    assert.match(item?.summary ?? "", /F-2026-001 from Wetsuit Supply \(120\.00 EUR\)/);
    assert.deepEqual(item?.tools, []);
    assert.equal(
      item?.links.dashboard,
      `${TEST_APP_URL}/dashboard/purchase-invoices?store=${STORE}`,
    );

    const noIntegrations = await apiKey({ ...everything, integrations: "none" });
    assert.equal(ofType((await list(noIntegrations())).items, "supplier_invoice").length, 0);

    await louezDb.db
      .update(louezDb.receivedInvoices)
      .set({ ourAction: "accepted" })
      .where(orm.eq(louezDb.receivedInvoices.id, invoiceId));
    assert.equal(ofType((await list()).items, "supplier_invoice").length, 0);
  });

  test("a rejected e-invoice, or one the network never received, shows until it goes through", async () => {
    const reservationId = await reservation("completed");
    const invoiceRow = (
      id: string,
      number: string,
      status: "rejected" | "failed" | "validated",
    ) => ({
      id,
      storeId: STORE,
      reservationId,
      customerId: CUSTOMER,
      type: "invoice" as const,
      kind: "initial" as const,
      number,
      issueDate: "2026-11-01",
      currency: "EUR",
      sellerSnapshot: {} as never,
      buyerSnapshot: {} as never,
      lines: [],
      vatBreakdown: [],
      totalExclTax: "100.00",
      totalTax: "20.00",
      totalInclTax: "120.00",
      en16931Snapshot: {} as never,
      documentId: nextId("ib_doc"),
      processingRule: "b2c" as const,
      transmissionStatus: status,
      nextAttemptAt: null,
      updatedAt: ago(HOUR),
    });
    const rejected = nextId("ib_inv");
    const failed = nextId("ib_inv");
    await louezDb.db
      .insert(louezDb.invoices)
      .values([
        invoiceRow(rejected, "F-1", "rejected"),
        invoiceRow(failed, "F-2", "failed"),
        invoiceRow(nextId("ib_inv"), "F-3", "validated"),
      ]);

    const items = ofType((await list()).items, "einvoice_rejected");
    assert.deepEqual(items.map((item) => item.details.invoiceNumber).sort(), ["F-1", "F-2"]);
    await louezDb.db
      .update(louezDb.invoices)
      .set({ transmissionStatus: "validated" })
      .where(orm.eq(louezDb.invoices.id, rejected));
    assert.deepEqual(
      ofType((await list()).items, "einvoice_rejected").map((item) => item.details.invoiceNumber),
      ["F-2"],
    );
  });

  /** A billing policy that stops new bookings, as the billing service sends it. */
  async function closeGate(effectiveFrom: Date, receivedAt: Date) {
    await louezDb.db.insert(louezDb.billingPolicies).values({
      storeId: STORE,
      version: 1,
      effectiveFrom,
      receivedAt,
      body: {
        schema: "louez.billing.policy/1",
        storeId: STORE,
        version: 1,
        effectiveFrom: effectiveFrom.toISOString(),
        issuedAt: effectiveFrom.toISOString(),
        newStoresCreatedFrom: null,
        offerKey: "test-offer",
        invoicing: "louez_legacy",
        currency: "EUR",
        applicationFee: { kind: "none" },
        marketplaceFeeMinor: 0,
        reservations: { allowed: false, reason: "payment_overdue" },
        notice: null,
        stripeCustomerId: null,
        labels: { offer: { fr: "Offre de test", en: "Test offer" }, notice: null },
      },
    });
  }

  test("billing that stops new bookings shows, to who may read settings, since the policy took effect here", async () => {
    const since = new Date(Math.floor(ago(HOUR).getTime() / 1000) * 1000);
    await closeGate(since, ago(2 * HOUR));

    const [item] = ofType((await list()).items, "billing_gate_closed");
    assert.equal(item?.id, `billing_gate_closed:${STORE}`);
    assert.equal(item?.severity, "critical");
    assert.equal(item?.occurredAt.getTime(), since.getTime());
    assert.match(item?.summary ?? "", /overdue fees/);
    assert.equal(
      item?.links.dashboard,
      `${TEST_APP_URL}/dashboard/settings/billing?store=${STORE}`,
    );
    // The other store's billing is its own.
    assert.equal(ofType((await list(session(OTHER_STORE))).items, "billing_gate_closed").length, 0);
    // Settings alone opens the inbox, without any reservation item.
    await reservation("pending");
    const settingsOnly = await apiKey({ ...none, settings: "read" });
    const seen = (await list(settingsOnly())).items;
    assert.deepEqual(
      seen.map((entry) => entry.type),
      ["billing_gate_closed"],
    );
  });

  test("a store not online yet shows what its launch still requires", async () => {
    await louezDb.db
      .update(louezDb.stores)
      .set({ onboardingCompleted: false })
      .where(orm.eq(louezDb.stores.id, STORE));
    const [item] = ofType((await list()).items, "store_not_live");
    assert.equal(item?.id, `store_not_live:${STORE}`);
    assert.deepEqual(item?.tools, ["stores_get_launch_checklist", "stores_go_live"]);
    assert.equal(item?.details.canGoLive, true);
    assert.equal(ofType((await list(session(OTHER_STORE))).items, "store_not_live").length, 0);
  });

  test("a store not online yet, with hours saved before a day held several ranges, shows its launch", async () => {
    // Hours saved before 2026-02-25: each day one openTime and closeTime, no `ranges`.
    const legacyDay = (isOpen: boolean) => ({ isOpen, openTime: "09:00", closeTime: "18:00" });
    await louezDb.db
      .update(louezDb.stores)
      .set({
        onboardingCompleted: false,
        settings: {
          ...SETTINGS,
          businessHours: {
            enabled: true,
            schedule: {
              0: legacyDay(false),
              1: legacyDay(true),
              2: legacyDay(true),
              3: legacyDay(true),
              4: legacyDay(true),
              5: legacyDay(true),
              6: legacyDay(true),
            },
            closurePeriods: [],
          },
        } as never,
      })
      .where(orm.eq(louezDb.stores.id, STORE));
    const answer = await list();
    const [item] = ofType(answer.items, "store_not_live");
    assert.equal(item?.id, `store_not_live:${STORE}`);
    assert.equal(answer.unavailable, undefined);
  });

  /** A supplier invoice not handled yet, with Super PDP connected. */
  async function supplierInvoice(createdAt: Date) {
    const connected = await louezDb.db.query.storeIntegrations.findFirst({
      where: orm.eq(louezDb.storeIntegrations.storeId, STORE),
    });
    if (!connected) {
      await louezDb.db.insert(louezDb.storeIntegrations).values({
        id: nextId("ib_int"),
        storeId: STORE,
        providerKey: "superpdp",
        category: "invoicing",
        enabled: true,
        status: "active",
      });
    }
    const id = nextId("ib_rin");
    await louezDb.db.insert(louezDb.receivedInvoices).values({
      id,
      storeId: STORE,
      superPdpInvoiceId: `spdp_${id}`,
      sellerName: "Wetsuit Supply",
      sellerIdentifier: "12345678900011",
      number: `F-${id}`,
      issueDate: "2026-11-01",
      totalExclTax: "100.00",
      totalTax: "20.00",
      totalInclTax: "120.00",
      currency: "EUR",
      latestStatus: "fr:200",
      createdAt,
      updatedAt: createdAt,
    });
    return id;
  }

  /** The supplier invoices' table gone while `run` runs, as before its migration. */
  async function withoutInvoicesTable<T>(run: () => Promise<T>): Promise<T> {
    await louezDb.db.execute(orm.sql`RENAME TABLE received_invoices TO received_invoices_away`);
    try {
      return await run();
    } finally {
      await louezDb.db.execute(orm.sql`RENAME TABLE received_invoices_away TO received_invoices`);
    }
  }

  test("a source that fails costs only its own items, named in unavailable and logged; acknowledging fails", async () => {
    const reservationId = await reservation("pending");
    await withoutInvoicesTable(async () => {
      const answer = await list();
      assert.deepEqual(
        answer.items.map((item) => item.id),
        [`booking_request:${reservationId}`],
      );
      assert.deepEqual(answer.unavailable, ["supplier_invoice"]);
      assert.equal(answer.hasMore, false);

      // One structured event: the store, the type, the error's sanitized facts.
      assert.equal(logged.length, 1);
      const [event] = logged as [
        { event: string; storeId: string; itemType: string; error: Record<string, unknown> },
      ];
      assert.equal(event.event, "inbox.source_failed");
      assert.equal(event.storeId, STORE);
      assert.equal(event.itemType, "supplier_invoice");
      assert.deepEqual(Object.keys(event).sort(), ["error", "event", "itemType", "storeId"]);
      const text = JSON.stringify(event.error);
      // No text: neither the query nor its parameters (the store id, the provider, the dates)…
      assert.equal(event.error.message, "[message withheld]");
      assert.ok(!text.includes("superpdp") && !text.includes(STORE.slice(3)), text);
      assert.ok(!text.includes("select"), text);
      // …and the driver's error as its code, its number and the table its message names.
      const cause = event.error.cause as
        | { code?: string; errno?: number; schemaObject?: { kind: string; name: string } }
        | undefined;
      assert.equal(cause?.code, "ER_NO_SUCH_TABLE");
      assert.equal(cause?.errno, 1146);
      assert.equal(cause?.schemaObject?.kind, "table");
      assert.equal(cause?.schemaObject?.name, "received_invoices");
      // Its frames are places in the repository.
      assert.ok(
        (event.error.frames as string[]).every((frame) =>
          /^(?:apps|packages)\/[^:]+:\d+:\d+$/.test(frame),
        ),
      );
      assert.ok(Array.isArray(event.error.frames) && event.error.frames.length > 0);

      // The source's own error: the transport answers it as an internal error.
      await assert.rejects(
        run(
          "acknowledge",
          { items: [{ id: "supplier_invoice:ib_rin_x", occurredAt: ago(HOUR) }] },
          session(),
        ),
        /received_invoices/,
      );
    });
  });

  test("items of a source that failed come once it works again, at the cursor, and the others only once", async () => {
    const request = await reservation("pending", { createdAt: ago(3 * HOUR) });
    const first = await supplierInvoice(ago(2 * HOUR));
    const second = await supplierInvoice(ago(HOUR));
    const ids = (items: InboxItem[]) => items.map((item) => item.id);

    // The outage: the request comes, the invoices cannot be read.
    const outage = await withoutInvoicesTable(() => list());
    assert.deepEqual(ids(outage.items), [`booking_request:${request}`]);
    assert.deepEqual(outage.unavailable, ["supplier_invoice"]);

    // Still down: nothing new, the request is not given again, the place is kept.
    const stillDown = await withoutInvoicesTable(() =>
      list(session(), { cursor: outage.nextCursor }),
    );
    assert.deepEqual(ids(stillDown.items), []);
    assert.deepEqual(stillDown.unavailable, ["supplier_invoice"]);

    // Back: the invoices come with the cursor, a page at a time, earlier than it.
    const back = await list(session(), { cursor: stillDown.nextCursor, limit: 1 });
    assert.deepEqual(ids(back.items), [`supplier_invoice:${first}`]);
    assert.equal(back.hasMore, true);
    assert.equal(back.unavailable, undefined);
    const rest = await list(session(), { cursor: back.nextCursor, limit: 1 });
    assert.deepEqual(ids(rest.items), [`supplier_invoice:${second}`]);
    assert.equal(rest.hasMore, false);

    // Caught up: nothing more, and the cursor holds one position again.
    const after = await list(session(), { cursor: rest.nextCursor });
    assert.deepEqual(ids(after.items), []);
    const decoded = JSON.parse(Buffer.from(after.nextCursor, "base64url").toString("utf8"));
    assert.equal(decoded.b, undefined);
  });

  test("a cursor whose types standing behind are not the inbox's, not behind it, or twice, is refused", async () => {
    const forged = (body: unknown) => Buffer.from(JSON.stringify(body)).toString("base64url");
    const at = { t: Date.now(), k: "~", r: "" };
    for (const b of [
      [[0, "", "", ["no_such_type"]]],
      [[0, "", "", []]],
      [[-1, "", "", ["supplier_invoice"]]],
      "supplier_invoice",
      // At the cursor's position, or after it.
      [[at.t, at.k, at.r, ["supplier_invoice"]]],
      [[at.t + 1, "", "", ["supplier_invoice"]]],
      // The same type twice, in one group or two.
      [[0, "", "", ["supplier_invoice", "supplier_invoice"]]],
      [
        [0, "", "", ["supplier_invoice"]],
        [1, "", "", ["supplier_invoice"]],
      ],
    ]) {
      await rejects(list(session(), { cursor: forged({ ...at, b }) }), "INVALID_CURSOR");
    }
  });

  test("a customer message the outbox gave up on shows, without the customer's name to who may not read customers", async () => {
    const reservationId = await reservation("confirmed");
    const effectId = nextId("ib_eff");
    await louezDb.db.insert(louezDb.apiEffects).values({
      id: effectId,
      storeId: STORE,
      reservationId,
      customerId: CUSTOMER,
      type: "reservation.customerMessage",
      payload: { channel: "email", notification: "customer_request_accepted" },
      status: "abandoned",
      attempts: 8,
      nextAttemptAt: ago(HOUR),
      createdAt: ago(3 * HOUR),
    });
    // Sent, and analytics nobody needs to hear about.
    await louezDb.db.insert(louezDb.apiEffects).values([
      {
        id: nextId("ib_eff"),
        storeId: STORE,
        reservationId,
        type: "reservation.customerMessage",
        payload: { channel: "sms" },
        status: "sent",
        createdAt: ago(3 * HOUR),
      },
      {
        id: nextId("ib_eff"),
        storeId: STORE,
        type: "reservation.statusAnalytics",
        payload: {},
        status: "abandoned",
        nextAttemptAt: ago(HOUR),
        createdAt: ago(3 * HOUR),
      },
    ]);

    const [item] = ofType((await list()).items, "message_not_sent");
    assert.equal(item?.id, `message_not_sent:${effectId}`);
    assert.match(
      item?.summary ?? "",
      /acceptance message \(email\) to the customer of reservation/,
    );
    assert.match(item?.summary ?? "", /Ada Lovelace/);
    const noCustomers = await apiKey({ ...everything, customers: "none" });
    const [redacted] = ofType((await list(noCustomers())).items, "message_not_sent");
    assert.doesNotMatch(redacted?.summary ?? "", /Ada/);
  });

  test("an operation whose outcome is unknown shows to the connection that made it and to the dashboard", async () => {
    const agent = await apiKey();
    const otherAgent = await apiKey();
    const operation = (
      actorKey: string,
      status: "unknown" | "running" | "succeeded",
      updatedAt: Date,
    ) => ({
      id: nextId("ib_op"),
      storeId: STORE,
      userId: OWNER,
      credentialKind: "api_key" as const,
      credentialId: actorKey,
      clientName: "Grok",
      transport: "mcp" as const,
      procedure: "dashboard.reservations.updateStatus",
      actorKey,
      inputHash: "0".repeat(64),
      status,
      targetId: "ib_res_target",
      createdAt: ago(2 * HOUR),
      updatedAt,
    });
    const unknown = operation(agent.id, "unknown", ago(HOUR));
    const lost = operation(agent.id, "running", ago(HOUR));
    const stillRunning = operation(agent.id, "running", ago(60_000));
    const others = operation(otherAgent.id, "unknown", ago(HOUR));
    await louezDb.db
      .insert(louezDb.apiOperations)
      .values([unknown, lost, stillRunning, others, operation(agent.id, "succeeded", ago(HOUR))]);

    const mine = ofType((await list(agent())).items, "operation_unknown").map((item) => item.id);
    assert.deepEqual(
      mine.sort(),
      [`operation_unknown:${unknown.id}`, `operation_unknown:${lost.id}`].sort(),
    );
    const dashboard = ofType((await list()).items, "operation_unknown");
    assert.equal(dashboard.length, 3);
    assert.equal(
      dashboard[0]?.links.dashboard,
      `${TEST_APP_URL}/dashboard/reservations/ib_res_target?store=${STORE}`,
    );
  });

  // --- Rights and isolation ---------------------------------------------------

  test("without payments read, no payment item; without reservations and settings, no inbox", async () => {
    const id = await reservation("confirmed", {
      depositStatus: "authorized",
      depositExpiresAt: ahead(DAY),
    });
    await activity(id, "payment_failed", { amount: 20 }, ago(HOUR));
    await reservation("pending");

    const noPayments = await apiKey({ ...everything, payments: "none" });
    const types = new Set((await list(noPayments())).items.map((item) => item.type));
    assert.ok(types.has("booking_request"));
    assert.ok(!types.has("payment_failed"));
    assert.ok(!types.has("deposit_expiring"));

    const productsOnly = await apiKey({ ...none, products: "read" });
    await rejects(list(productsOnly()), "PERMISSION_DENIED");
  });

  test("a key of one store never sees another store's items", async () => {
    await reservation("pending", { store: OTHER_STORE });
    const mine = await reservation("pending");
    const agent = await apiKey();
    assert.deepEqual(
      (await list(agent())).items.map((item) => item.reservation?.id),
      [mine],
    );
    const other = (await list(session(OTHER_STORE))).items;
    assert.equal(other.length, 1);
    assert.notEqual(other[0]?.reservation?.id, mine);
  });

  // --- Cursor and pages -------------------------------------------------------

  test("the cursor returns only what entered since, and stays put when nothing did", async () => {
    const reader = async () => ({
      store: await storeRow(),
      urls: ports.urls,
      hostedBy: null,
      reads: {
        reservations: true,
        customers: true,
        payments: true,
        products: true,
        settings: true,
      },
      operationsOf: null,
    });
    const first = await reservation("pending", { createdAt: ago(2 * HOUR) });
    // A call as if made an hour ago reads up to then.
    const earlier = await inbox.listInbox(await reader(), {}, { now: ago(HOUR) });
    assert.deepEqual(
      earlier.items.map((item) => item.reservation?.id),
      [first],
    );
    const second = await reservation("pending", { createdAt: ago(30 * 60_000) });

    const now = await inbox.listInbox(await reader(), { cursor: earlier.nextCursor });
    assert.deepEqual(
      now.items.map((item) => item.reservation?.id),
      [second],
    );
    // The same cursor again: the same answer, read-only.
    const again = await inbox.listInbox(await reader(), { cursor: earlier.nextCursor });
    assert.deepEqual(again.items, now.items);
    // Nothing new: nothing returned, and the next cursor is still usable.
    const quiet = await inbox.listInbox(await reader(), { cursor: now.nextCursor });
    assert.deepEqual(quiet.items, []);
    assert.equal(quiet.hasMore, false);
    const later = await inbox.listInbox(await reader(), { cursor: quiet.nextCursor });
    assert.deepEqual(later.items, []);

    // A late return that turns late after the cursor shows then.
    const returning = await reservation("ongoing", {
      start: ago(DAY),
      end: ago(10 * 60_000),
      pickedUpAt: ago(DAY),
      createdAt: ago(2 * DAY),
    });
    const turned = await inbox.listInbox(await reader(), { cursor: earlier.nextCursor });
    assert.deepEqual(
      turned.items.map((item) => [item.type, item.reservation?.id]),
      [
        ["booking_request", second],
        ["return_overdue", returning],
      ],
    );
  });

  test("what reaches Louez after a poll, dated earlier outside, comes with the next poll", async () => {
    const reader = async () => ({
      store: await storeRow(),
      urls: ports.urls,
      hostedBy: null,
      reads: {
        reservations: true,
        customers: true,
        payments: true,
        products: true,
        settings: true,
        integrations: true,
      },
      operationsOf: null,
    });
    // A poll made an hour ago.
    const earlier = await inbox.listInbox(await reader(), {}, { now: ago(HOUR) });
    assert.deepEqual(earlier.items, []);

    // Since: a dispute Stripe opened two days ago, written by a webhook ten
    // minutes ago; a billing policy in force for two hours, received ten
    // minutes ago; a rental whose end an edit moved two days back.
    const disputed = await reservation("completed");
    await louezDb.db.insert(louezDb.paymentDisputes).values({
      id: "dp_test_000000000002",
      paymentId: nextId("ib_pay"),
      reservationId: disputed,
      amountMinor: 5_000,
      currency: "eur",
      status: "open",
      stripeStatus: "needs_response",
      openedAt: ago(2 * DAY),
      createdAt: ago(10 * 60_000),
    });
    await closeGate(ago(2 * HOUR), ago(10 * 60_000));
    const shortened = await reservation("ongoing", {
      start: ago(3 * DAY),
      end: ago(2 * DAY),
      pickedUpAt: ago(3 * DAY),
      createdAt: ago(4 * DAY),
    });
    await louezDb.db
      .update(louezDb.reservations)
      .set({ scheduleChangedAt: ago(10 * 60_000) })
      .where(orm.eq(louezDb.reservations.id, shortened));

    const next = await inbox.listInbox(await reader(), { cursor: earlier.nextCursor });
    assert.deepEqual(next.items.map((item) => item.type).sort(), [
      "billing_gate_closed",
      "dispute_open",
      "return_overdue",
    ]);
    const gate = next.items.find((item) => item.type === "billing_gate_closed");
    assert.ok(Math.abs((gate?.occurredAt.getTime() ?? 0) - ago(10 * 60_000).getTime()) < 5_000);
  });

  test("an item shows only once it is thirty seconds old", async () => {
    await reservation("pending", { createdAt: ago(5_000) });
    assert.equal((await list()).items.length, 0);
  });

  test("pages follow one order and hold every item once", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(await reservation("pending", { createdAt: ago((10 - index) * 60_000) }));
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await list(session(), { limit: 2, ...(cursor ? { cursor } : {}) });
      assert.ok(page.items.length <= 2);
      seen.push(...page.items.map((item) => item.reservation?.id ?? ""));
      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }
    assert.deepEqual(seen, ids);
    await rejects(list(session(), { limit: 101 }), "BAD_REQUEST");
    await rejects(list(session(), { cursor: "not-a-cursor" }), "INVALID_CURSOR");
  });

  test("what a client's directory forbids neither shows nor takes a page's room", async () => {
    const { CHATGPT_CLIENT_ID, clientWithholding } = await import("../../platform/agent-clients");
    const { withheldProcedurePaths } = await import("../../platform/withheld-procedures");
    const GRANT = "ib_grant_chatgpt";
    const withheld = clientWithholding({
      clientId: CHATGPT_CLIENT_ID,
      name: "ChatGPT",
      redirectUris: [],
    });
    const withheldProcedures = await withheldProcedurePaths(withheld);
    assert.ok(withheldProcedures.includes("dashboard.products.enhanceImage"));
    assert.ok(withheldProcedures.includes("dashboard.products.removeImageBackground"));

    // Oldest first: four items ChatGPT may act on, six it may not, two of them last.
    const ids: string[] = [];
    const visible: string[] = [];
    const operation = async (procedure: string, minutesAgo: number) => {
      const id = nextId("ib_op");
      await louezDb.db.insert(louezDb.apiOperations).values({
        id,
        storeId: STORE,
        userId: OWNER,
        credentialKind: "oauth",
        credentialId: GRANT,
        clientName: "ChatGPT",
        transport: "mcp",
        procedure,
        actorKey: GRANT,
        inputHash: "0".repeat(64),
        status: "unknown",
        createdAt: ago(HOUR),
        updatedAt: ago(minutesAgo * 60_000),
      });
      const item = `operation_unknown:${id}`;
      ids.push(item);
      if (!withheldProcedures.includes(procedure)) visible.push(item);
    };
    const failedJob = async (
      kind: "product_image_enhance" | "product_image_remove_background",
      minutesAgo: number,
    ) => {
      const id = nextId("ib_job");
      await louezDb.db.insert(louezDb.apiJobs).values({
        id,
        storeId: STORE,
        kind,
        targetId: "ib_prd_photo",
        status: "failed",
        slotKey: id,
        input: {},
        error: { code: "IMAGE_EMPTY", message: "empty", retryable: false },
        userId: OWNER,
        credentialKind: "api_key",
        createdAt: ago(HOUR),
        finishedAt: ago(minutesAgo * 60_000),
      });
      ids.push(`image_job_failed:${id}`);
    };
    await operation("dashboard.reservations.updateStatus", 10);
    await operation("dashboard.products.enhanceImage", 9);
    await operation("dashboard.products.removeImageBackground", 8);
    await operation("dashboard.reservations.updateStatus", 7);
    await failedJob("product_image_enhance", 6);
    await operation("dashboard.reservations.updateStatus", 5);
    await failedJob("product_image_remove_background", 4);
    await operation("dashboard.reservations.updateStatus", 3);
    await operation("dashboard.products.enhanceImage", 2);
    await failedJob("product_image_enhance", 1.5);

    const pages = async (reader: Parameters<typeof inbox.listInbox>[0]) => {
      const seen: string[][] = [];
      const more: boolean[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = await inbox.listInbox(reader, { limit: 2, ...(cursor ? { cursor } : {}) });
        seen.push(page.items.map((item) => item.id));
        more.push(page.hasMore);
        cursor = page.nextCursor;
        if (!page.hasMore) break;
      }
      const after = await inbox.listInbox(reader, { limit: 2, ...(cursor ? { cursor } : {}) });
      return { seen, more, after: after.items.length };
    };
    const base = {
      store: await storeRow(),
      urls: ports.urls,
      hostedBy: null,
      reads: { products: true },
      operationsOf: GRANT,
    };

    // ChatGPT: two full pages of what it may act on, the second the last.
    assert.equal(visible.length, 4);
    assert.deepEqual(
      await pages({ ...base, withheld: withheld.capabilities, withheldProcedures }),
      { seen: [visible.slice(0, 2), visible.slice(2)], more: [true, false], after: 0 },
    );
    // A caller with nothing withheld sees every item, in the same order.
    const all = await pages(base);
    assert.deepEqual(all.seen.flat(), ids);
    assert.deepEqual(all.more, [true, true, true, true, false]);
  });

  // --- Acknowledging ----------------------------------------------------------

  test("an acknowledged item leaves the store's inbox for everyone, until it comes back", async () => {
    const id = await reservation("confirmed");
    await activity(id, "payment_failed", { amount: 20 }, ago(2 * HOUR));
    const [item] = ofType((await list()).items, "payment_failed");
    assert.ok(item);

    const agent = await apiKey();
    const result = await run(
      "acknowledge",
      { items: [{ id: item.id, occurredAt: item.occurredAt }] },
      agent(),
    );
    assert.deepEqual(result, { acknowledged: 1, alreadyAcknowledged: 0, rejected: [] });
    assert.equal(ofType((await list()).items, "payment_failed").length, 0);
    assert.equal(ofType((await list(agent())).items, "payment_failed").length, 0);
    const [row] = await louezDb.db
      .select({
        userId: louezDb.inboxAcknowledgements.userId,
        credentialId: louezDb.inboxAcknowledgements.credentialId,
      })
      .from(louezDb.inboxAcknowledgements);
    assert.deepEqual(row, { userId: OWNER, credentialId: agent.id });

    // Twice: nothing changes.
    const twice = await run(
      "acknowledge",
      { items: [{ id: item.id, occurredAt: item.occurredAt }] },
      session(),
    );
    assert.deepEqual(twice, { acknowledged: 0, alreadyAcknowledged: 1, rejected: [] });

    // A new failure is a new item.
    const latest = await activity(id, "payment_failed", { amount: 20 }, ago(HOUR));
    assert.deepEqual(
      ofType((await list()).items, "payment_failed").map((entry) => entry.id),
      [`payment_failed:${latest}`],
    );
    // Another store's item is not in this store's inbox.
    const other = await reservation("pending", { store: OTHER_STORE });
    const [theirs] = (await list(session(OTHER_STORE))).items;
    assert.ok(theirs);
    const crossed = await run(
      "acknowledge",
      { items: [{ id: theirs.id, occurredAt: theirs.occurredAt }] },
      session(),
    );
    assert.deepEqual(crossed.rejected, [
      { id: theirs.id, occurredAt: theirs.occurredAt, currentOccurredAt: null },
    ]);
    assert.deepEqual(
      (await list(session(OTHER_STORE))).items.map((entry) => entry.reservation?.id),
      [other],
    );
  });

  test("only an item the inbox holds now, with its occurredAt, is acknowledged; the others come back rejected", async () => {
    await reservation("pending");
    const [item] = (await list()).items;
    assert.ok(item);
    const forged = Array.from({ length: 100 }, (_, index) => ({
      id: "booking_request:does_not_exist",
      occurredAt: ago(index * 1000),
    }));
    const refused = await run("acknowledge", { items: forged }, session());
    assert.equal(refused.acknowledged, 0);
    assert.equal(refused.rejected.length, 100);
    assert.ok(refused.rejected.every((entry) => entry.currentOccurredAt === null));

    // Another occurrence of a real item: the current one comes back.
    const shifted = new Date(item.occurredAt.getTime() - 1000);
    const stale = await run(
      "acknowledge",
      { items: [{ id: item.id, occurredAt: shifted }] },
      session(),
    );
    assert.deepEqual(stale.rejected, [
      { id: item.id, occurredAt: shifted, currentOccurredAt: item.occurredAt },
    ]);
    assert.equal((await louezDb.db.select().from(louezDb.inboxAcknowledgements)).length, 0);

    // A batch is accepted in part: the real item is marked, the unknown one is not.
    const mixed = await run(
      "acknowledge",
      {
        items: [
          { id: item.id, occurredAt: item.occurredAt },
          { id: "booking_request:does_not_exist", occurredAt: item.occurredAt },
        ],
      },
      session(),
    );
    assert.equal(mixed.acknowledged, 1);
    assert.deepEqual(
      mixed.rejected.map((entry) => entry.id),
      ["booking_request:does_not_exist"],
    );
    assert.equal((await louezDb.db.select().from(louezDb.inboxAcknowledgements)).length, 1);

    // Items read in code take the same check: the billing gate.
    await closeGate(ago(2 * HOUR), ago(2 * HOUR));
    const [gate] = ofType((await list()).items, "billing_gate_closed");
    assert.ok(gate);
    assert.deepEqual(
      await run(
        "acknowledge",
        { items: [{ id: gate.id, occurredAt: gate.occurredAt }] },
        session(),
      ),
      { acknowledged: 1, alreadyAcknowledged: 0, rejected: [] },
    );
    assert.equal(ofType((await list()).items, "billing_gate_closed").length, 0);
  });

  test("a key that may change payments acknowledges a failed payment it reads", async () => {
    const id = await reservation("confirmed");
    await activity(id, "payment_failed", { amount: 20 }, ago(HOUR));
    const payer = await apiKey({ ...none, reservations: "read", payments: "write" });
    const [item] = ofType((await list(payer())).items, "payment_failed");
    assert.ok(item);
    assert.deepEqual(
      await run("acknowledge", { items: [{ id: item.id, occurredAt: item.occurredAt }] }, payer()),
      { acknowledged: 1, alreadyAcknowledged: 0, rejected: [] },
    );
    // It may not acknowledge a booking request: that needs reservations write.
    await reservation("pending");
    const [request] = ofType((await list(payer())).items, "booking_request");
    assert.ok(request);
    await rejects(
      run("acknowledge", { items: [{ id: request.id, occurredAt: request.occurredAt }] }, payer()),
      "PERMISSION_DENIED",
    );
  });

  test("two acknowledgements at once keep the store at its cap", async () => {
    const cap = inbox.INBOX_ACKNOWLEDGEMENTS_PER_STORE;
    const old = Array.from({ length: cap }, (_, index) => ({
      storeId: STORE,
      itemType: "booking_request",
      recordId: `ib_cap_${index}`,
      occurredAt: ago(DAY),
      userId: OWNER,
      createdAt: ago(DAY + index * 1000),
    }));
    for (let index = 0; index < old.length; index += 500) {
      await louezDb.db.insert(louezDb.inboxAcknowledgements).values(old.slice(index, index + 500));
    }
    for (let index = 0; index < 200; index += 1) {
      await reservation("pending", { createdAt: ago(HOUR + index * 1000) });
    }
    const first = await list(session(), { limit: 100 });
    const second = await list(session(), { limit: 100, cursor: first.nextCursor });
    const batch = (items: InboxItem[]) => ({
      items: items.map((entry) => ({ id: entry.id, occurredAt: entry.occurredAt })),
    });

    // Both read their items, then wait on the store row; each then marks and evicts alone.
    const results = await raceOnLockedRow(database, { table: "stores", id: STORE }, [
      () => run("acknowledge", batch(first.items), session()),
      () => run("acknowledge", batch(second.items), session()),
    ]);
    assert.deepEqual(
      results.map((result) => result.acknowledged),
      [100, 100],
    );
    const rows = await louezDb.db
      .select({ id: louezDb.inboxAcknowledgements.id })
      .from(louezDb.inboxAcknowledgements)
      .where(orm.eq(louezDb.inboxAcknowledgements.storeId, STORE));
    assert.equal(rows.length, cap);
    assert.deepEqual((await list()).items, []);
  });

  test("a store keeps its latest acknowledgements, and the cron drops those past 90 days", async () => {
    const rows = (store: string, count: number, createdAt: (index: number) => Date) =>
      Array.from({ length: count }, (_, index) => ({
        storeId: store,
        itemType: "booking_request",
        recordId: `ib_old_${store.slice(-3)}_${index}`,
        occurredAt: ago(DAY),
        userId: OWNER,
        createdAt: createdAt(index),
      }));
    const capped = rows(STORE, inbox.INBOX_ACKNOWLEDGEMENTS_PER_STORE, (index) =>
      ago(DAY + index * 1000),
    );
    for (let index = 0; index < capped.length; index += 500) {
      await louezDb.db
        .insert(louezDb.inboxAcknowledgements)
        .values(capped.slice(index, index + 500));
    }
    const id = await reservation("pending");
    const [item] = (await list()).items;
    assert.equal(item?.reservation?.id, id);
    await run("acknowledge", { items: [{ id: item.id, occurredAt: item.occurredAt }] }, session());
    const mine = await louezDb.db
      .select({ recordId: louezDb.inboxAcknowledgements.recordId })
      .from(louezDb.inboxAcknowledgements)
      .where(orm.eq(louezDb.inboxAcknowledgements.storeId, STORE));
    assert.equal(mine.length, inbox.INBOX_ACKNOWLEDGEMENTS_PER_STORE);
    const kept = new Set(mine.map((row) => row.recordId));
    assert.ok(kept.has(id), "the new mark is kept");
    assert.ok(
      !kept.has(`ib_old_${STORE.slice(-3)}_${inbox.INBOX_ACKNOWLEDGEMENTS_PER_STORE - 1}`),
      "the oldest goes",
    );

    await louezDb.db.insert(louezDb.inboxAcknowledgements).values([
      ...rows(OTHER_STORE, 2, () => ago(91 * DAY)),
      ...rows(OTHER_STORE, 1, () => ago(89 * DAY)).map((row) => ({
        ...row,
        recordId: "ib_recent",
      })),
    ]);
    assert.equal(await inbox.pruneInboxAcknowledgements(), 2);
    const others = await louezDb.db
      .select({ recordId: louezDb.inboxAcknowledgements.recordId })
      .from(louezDb.inboxAcknowledgements)
      .where(orm.eq(louezDb.inboxAcknowledgements.storeId, OTHER_STORE));
    assert.deepEqual(
      others.map((row) => row.recordId),
      ["ib_recent"],
    );
  });

  test("acknowledging needs write access to the item's first domain, and a real item id", async () => {
    const readOnly = await apiKey({ ...everything, reservations: "read", payments: "read" });
    await rejects(
      run(
        "acknowledge",
        { items: [{ id: "booking_request:x", occurredAt: ago(HOUR) }] },
        readOnly(),
      ),
      "PERMISSION_DENIED",
    );
    const noPaymentsWrite = await apiKey({ ...everything, payments: "read" });
    await rejects(
      run(
        "acknowledge",
        { items: [{ id: "payment_failed:x", occurredAt: ago(HOUR) }] },
        noPaymentsWrite(),
      ),
      "PERMISSION_DENIED",
    );
    await rejects(
      run("acknowledge", { items: [{ id: "nonsense:x", occurredAt: ago(HOUR) }] }, session()),
      "INBOX_ITEM_INVALID",
    );
  });

  async function storeRow() {
    const row = await louezDb.db.query.stores.findFirst({
      where: orm.eq(louezDb.stores.id, STORE),
    });
    assert.ok(row);
    return row as typeof row & { settings: typeof SETTINGS };
  }
});
