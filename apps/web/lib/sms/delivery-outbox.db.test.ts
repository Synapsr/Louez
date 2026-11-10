import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import type { ApiEffectSenders } from "@louez/api/platform/effects";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { resolveFormatLocale } from "@/lib/i18n/format-locale";

// A customer's SMS through the outbox, end to end, with the provider faked and
// the timings scaled down: the outbox's claim, timeout, lease and retry, the
// reservation sender, the SMS senders and the records on the database.
//
// - A run that times out after the provider accepted, then retried, sends
//   nothing twice: the SMS is keyed by the outbox row.
// - A prepaid credit that waits on the credits' lock does not hold the SMS's
//   row: the row is sent at once, the credit taken apart, once.

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: unknown,
    next: (specifier: string, context: unknown) => unknown,
  ) {
    return specifier === "server-only"
      ? { url: "node:module", shortCircuit: true }
      : next(specifier, context);
  },
});

const provider = { delayMs: 0, submissions: 0 };
const debitDispatches: string[][] = [];

mock.module("@/lib/sms/client", {
  namedExports: {
    isSmsConfigured: () => true,
    sendSms: async () => {
      provider.submissions += 1;
      const number = provider.submissions;
      // Accepted, but slower than the sender's time: the outbox gives up first.
      await new Promise((resolve) => setTimeout(resolve, provider.delayMs));
      return { success: true, messageId: `provider_${number}` };
    },
  },
});
mock.module("@/lib/plan-limits", {
  namedExports: {
    getSmsQuotaStatus: async () => ({ allowed: true, current: 0, planLimit: 10, planSlug: "pro" }),
    determineSmsSource: async () => "topup",
  },
});
mock.module("@/lib/api/effects", {
  namedExports: {
    dispatchApiEffects: (ids: string[]) => {
      debitDispatches.push(ids);
    },
  },
});
// Modules the SMS path does not use, which import "server-only" through require.
mock.module("@/lib/notifications/customer-reminder-preferences", {
  namedExports: { getCustomerReminderPreferences: async () => null },
});
mock.module("@/lib/i18n/configured-format-locale", {
  namedExports: { getConfiguredFormatLocale: (locale?: string) => resolveFormatLocale(locale) },
});
// What the reservation's other rows use, not queued here.
const notQueued = () => {
  throw new Error("Not queued in these tests");
};
mock.module("@/lib/product-analytics/analytics", {
  namedExports: { captureReservationActionSucceededOrThrow: notQueued },
});
mock.module("@/lib/discord/platform-notifications", {
  namedExports: { sendPlatformReservationStatus: notQueued },
});
mock.module("@/lib/reservations/instant-access", {
  namedExports: { createReservationInstantAccessUrl: notQueued },
});
// The store's own notifications: other rows, not queued here.
mock.module("@/lib/notifications/dispatcher", {
  namedExports: { sendStoreNotificationChannel: async () => ({ skipped: "not under test" }) },
});
const noEmail = () => {
  throw new Error("No email in these tests");
};
mock.module("@/lib/email/send", {
  namedExports: Object.fromEntries(
    [
      "sendRequestReceivedEmail",
      "sendRequestAcceptedEmail",
      "sendRequestRejectedEmail",
      "sendReservationConfirmationEmail",
      "sendReservationCancelledEmail",
      "sendReminderPickupEmail",
      "sendReminderReturnEmail",
      "sendPaymentRequestEmail",
      "sendDepositAuthorizationRequestEmail",
      "sendQuoteSentEmail",
      "sendStatusChangeAdminEmail",
      "sendNewRequestLandlordEmail",
      "sendPaymentAdminEmail",
    ].map((name) => [name, noEmail]),
  ),
});
mock.module("@/lib/evlog", {
  namedExports: { log: { warn: () => {}, error: () => {}, info: () => {} } },
});

const USER = "user_sms_outbox";
const STORE = "store_sms_outbox_01";
const CUSTOMER = "cus_sms_outbox_0001";
const RESERVATION = "res_sms_outbox_0001";
/** Shorter than the provider's answer, as the outbox's two minutes are shorter than three lock waits. */
const TIMING = { sendTimeoutMs: 300, leaseMs: 31_000 };

describe("customer SMS through the outbox (database)", { skip: skipWithoutTestDatabase() }, () => {
  let database: TestDatabase;
  let louezDb: typeof import("@louez/db");
  let outbox: typeof import("@louez/api/platform/effects");
  let senders: ApiEffectSenders;

  before(async () => {
    database = await createTestDatabase("sms_delivery_outbox");
    louezDb = await import("@louez/db");
    outbox = await import("@louez/api/platform/effects");
    const { createReservationEffectSenders } =
      await import("@/lib/reservations/status-change-effects");
    const { createSmsEffectSenders } = await import("./sms-effects");
    // Only the effect types this test queues.
    senders = {
      ...createReservationEffectSenders(),
      ...createSmsEffectSenders(),
    } as ApiEffectSenders;

    await louezDb.db.insert(louezDb.users).values({ id: USER, email: "sms@outbox.test" });
    await louezDb.db.insert(louezDb.stores).values({
      id: STORE,
      userId: USER,
      name: "Kayaks",
      slug: "sms-outbox",
      settings: { country: "FR", currency: "EUR" } as never,
    });
    await louezDb.db.insert(louezDb.customers).values({
      id: CUSTOMER,
      storeId: STORE,
      email: "ada@outbox.test",
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "+33612345678",
    });
    await louezDb.db.insert(louezDb.reservations).values({
      id: RESERVATION,
      storeId: STORE,
      customerId: CUSTOMER,
      number: "2030-0001",
      status: "confirmed",
      startDate: new Date("2030-06-01T12:00:00Z"),
      endDate: new Date("2030-06-03T12:00:00Z"),
      subtotalAmount: "20.00",
      depositAmount: "50.00",
      totalAmount: "70.00",
      source: "manual",
    });
  });

  after(async () => {
    await louezDb?.db.$client.end();
    await database?.drop();
  });

  beforeEach(async () => {
    await louezDb.db.delete(louezDb.apiEffects);
    await louezDb.db.delete(louezDb.smsLogs);
    await louezDb.db.delete(louezDb.smsCredits);
    await louezDb.db.insert(louezDb.smsCredits).values({ storeId: STORE, balance: 5 });
    provider.delayMs = 0;
    provider.submissions = 0;
    debitDispatches.length = 0;
  });

  /** A customer's SMS queued as a status change queues it. */
  async function queueCustomerSms() {
    const [id] = await louezDb.db.transaction((tx) =>
      outbox.enqueueEffects(tx, STORE, [
        {
          type: "reservation.customerMessage",
          orderingKey: `reservation:${RESERVATION}:customer:sms`,
          reservationId: RESERVATION,
          customerId: CUSTOMER,
          payload: {
            channel: "sms",
            notification: "customer_reservation_cancelled",
            store: {
              id: STORE,
              name: "Kayaks",
              slug: "sms-outbox",
              email: null,
              phone: null,
              address: null,
              logoUrl: null,
              darkLogoUrl: null,
              theme: null,
              settings: { country: "FR", currency: "EUR" } as never,
              emailSettings: null,
              customerNotificationSettings: null,
              hasTerms: false,
            },
            customer: {
              id: CUSTOMER,
              firstName: "Ada",
              lastName: "Lovelace",
              email: "ada@outbox.test",
              phone: "+33612345678",
            },
            reservation: {
              id: RESERVATION,
              number: "2030-0001",
              startDate: "2030-06-01T12:00:00.000Z",
              endDate: "2030-06-03T12:00:00.000Z",
              totalAmount: "70.00",
              subtotalAmount: "20.00",
              depositAmount: "50.00",
              taxRate: null,
              subtotalExclTax: null,
              taxAmount: null,
              locale: "fr",
            },
            items: [{ name: "Kayak", quantity: 1, unitPrice: "20.00", totalPrice: "20.00" }],
            rejectionReason: null,
          },
        },
      ]),
    );
    assert.ok(id);
    return id;
  }

  const rowOf = async (id: string) => {
    const [row] = await louezDb.db
      .select({ status: louezDb.apiEffects.status, lastError: louezDb.apiEffects.lastError })
      .from(louezDb.apiEffects)
      .where(eq(louezDb.apiEffects.id, id));
    return row;
  };
  const logs = () =>
    louezDb.db
      .select({ id: louezDb.smsLogs.id, creditSource: louezDb.smsLogs.creditSource })
      .from(louezDb.smsLogs);
  const credits = async () => {
    const [row] = await louezDb.db
      .select({ balance: louezDb.smsCredits.balance, totalUsed: louezDb.smsCredits.totalUsed })
      .from(louezDb.smsCredits)
      .where(eq(louezDb.smsCredits.storeId, STORE));
    return row;
  };
  /** The lease of a timed-out run ends, as it would five minutes later. */
  const endLease = (id: string) =>
    louezDb.db
      .update(louezDb.apiEffects)
      .set({ lockedUntil: sql`TIMESTAMPADD(SECOND, -1, NOW(3))` })
      .where(eq(louezDb.apiEffects.id, id));
  const until = async (check: () => Promise<boolean>, what: string) => {
    const deadline = Date.now() + 10_000;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  test("a run that timed out after the provider accepted is retried without a second SMS", async () => {
    const id = await queueCustomerSms();
    provider.delayMs = 600;

    const first = await outbox.dispatchEffects([id], senders, TIMING);
    assert.deepEqual(first, { sent: 0, failed: 1, skipped: 0 });
    assert.match((await rowOf(id))?.lastError ?? "", /^Outcome unknown/);
    // The late run goes on: the provider accepts, the acceptance is written under the row's id.
    await until(async () => (await logs()).length === 1, "the acceptance");
    assert.deepEqual(
      (await logs()).map((row) => row.id),
      [id],
    );

    await endLease(id);
    provider.delayMs = 0;
    const retry = await outbox.dispatchEffects([id], senders, TIMING);
    assert.deepEqual(retry, { sent: 1, failed: 0, skipped: 0 });
    assert.equal(provider.submissions, 1, "one submission to the provider");
    assert.equal((await rowOf(id))?.status, "sent");
    assert.equal((await logs()).length, 1);
  });

  test("a prepaid credit stuck behind the credits' lock neither holds the SMS nor is taken twice", async () => {
    const holder = await database.connect();
    try {
      await holder.beginTransaction();
      // Another write holds the store's credits longer than a sender's time.
      await holder.query("SELECT id FROM sms_credits WHERE store_id = ? FOR UPDATE", [STORE]);

      const id = await queueCustomerSms();
      const sent = await outbox.dispatchEffects([id], senders, TIMING);
      assert.deepEqual(sent, { sent: 1, failed: 0, skipped: 0 }, "the SMS's row is done at once");
      assert.equal(provider.submissions, 1);
      assert.deepEqual(await logs(), [{ id, creditSource: "topup_pending" }]);

      const debits = debitDispatches.flat();
      assert.equal(debits.length, 1, "its credit is handed to the outbox");
      const [debit] = debits;
      assert.ok(debit);
      const stuck = await outbox.dispatchEffects([debit], senders, TIMING);
      assert.deepEqual(stuck, { sent: 0, failed: 1, skipped: 0 }, "the credit waits, out of time");

      await holder.commit();
      // The late run takes the credit once the lock is free.
      await until(
        async () => (await logs())[0]?.creditSource === "topup",
        "the credit taken by the late run",
      );
      await endLease(debit);
      const retried = await outbox.dispatchEffects([debit], senders, TIMING);
      assert.deepEqual(retried, { sent: 1, failed: 0, skipped: 0 });
      assert.deepEqual(await credits(), { balance: 4, totalUsed: 1 }, "taken once");
      assert.equal(provider.submissions, 1, "and the SMS was never sent again");
    } finally {
      await holder.end();
    }
  });
});
