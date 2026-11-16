import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, beforeEach, describe, mock, test } from "node:test";

import { eq } from "drizzle-orm";

import type { ApiEffect, ApiEffectSenders } from "@louez/api/platform/effects";
import { createTestDatabase, skipWithoutTestDatabase, type TestDatabase } from "@louez/db/testing";

import { closeNetworkForSuite } from "@/lib/testing/network-guard";

// A status change's message to the customer, through the outbox, on an
// instance with no e-mail service: its e-mail is owed and can never go out,
// so its sender gives it up at once (one attempt, `abandoned`), and the
// store's inbox lists it with why, for the store to tell the customer itself.
// With e-mail, the same row goes out. The provider is a fake: nothing leaves.

// The API's modules import these shared packages by name; loaded through require.
for (const name of [
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
  "@louez/types",
]) {
  mock.module(name, { namedExports: createRequire(import.meta.url)(name) });
}

/** Whether this instance has an e-mail service, as `@louez/email` reads it. */
const transport = { configured: false };
mock.module("@louez/email", {
  namedExports: {
    isEmailConfigured: () => transport.configured,
    sendEmail: async () => {
      throw new Error("no e-mail is sent in this suite");
    },
  },
});

// The providers the sender calls: only the customer's channel is expected,
// and it notes what it was asked; the others would be a mistake here.
const provider: Array<{ event: string; channel: string }> = [];
const unexpected = (name: string) => async () => {
  throw new Error(`${name} is not called in this suite`);
};
mock.module("@/lib/notifications/customer-dispatcher", {
  namedExports: {
    sendCustomerNotificationChannel: async (
      event: string,
      _ctx: unknown,
      channel: string,
      beforeSend: () => Promise<void>,
    ) => {
      await beforeSend();
      provider.push({ event, channel });
      return undefined;
    },
  },
});
mock.module("@/lib/reservations/instant-access", {
  namedExports: {
    createReservationInstantAccessUrl: async () => "https://status-inbox.test/contract",
  },
});
mock.module("@/lib/notifications/dispatcher", {
  namedExports: { sendStoreNotificationChannel: unexpected("the store's notification") },
});
mock.module("@/lib/discord/platform-notifications", {
  namedExports: { sendPlatformReservationStatus: unexpected("the platform's notice") },
});
mock.module("@/lib/product-analytics/analytics", {
  namedExports: { captureReservationActionSucceededOrThrow: unexpected("analytics") },
});

const USER = "user_status_inbox";
const STORE = "store_status_inbox_01";
const CUSTOMER = "cus_status_inbox_0001";
const RESERVATION = "res_status_inbox_0001";
const TO = "ada@status-inbox.test";
const START = "2030-06-04T12:00:00.000Z";
const END = "2030-06-06T12:00:00.000Z";

describe(
  "a status change's message without e-mail (database)",
  { skip: skipWithoutTestDatabase() },
  () => {
    closeNetworkForSuite();

    let database: TestDatabase;
    let louezDb: typeof import("@louez/db");
    let outbox: typeof import("@louez/api/platform/effects");
    let inbox: typeof import("@louez/api/services/inbox");
    let testUrls: typeof import("@louez/api/platform/test-urls");
    let senders: ApiEffectSenders;

    before(async () => {
      database = await createTestDatabase("status_change_message_inbox");
      louezDb = await import("@louez/db");
      outbox = await import("@louez/api/platform/effects");
      inbox = await import("@louez/api/services/inbox");
      testUrls = await import("@louez/api/platform/test-urls");
      const { createReservationEffectSenders } = await import("./status-change-effects");
      // As the app builds it: it reads the instance's e-mail service through
      // `@louez/email`; the providers are the fakes above.
      senders = createReservationEffectSenders() as ApiEffectSenders;

      await louezDb.db.insert(louezDb.users).values({ id: USER, email: "owner@status-inbox.test" });
      await louezDb.db.insert(louezDb.stores).values({
        id: STORE,
        userId: USER,
        name: "Kayaks",
        slug: "status-inbox",
        settings: { country: "GB", currency: "GBP" } as never,
      });
      await louezDb.db.insert(louezDb.customers).values({
        id: CUSTOMER,
        storeId: STORE,
        email: TO,
        firstName: "Ada",
        lastName: "Lovelace",
      });
      await louezDb.db.insert(louezDb.reservations).values({
        id: RESERVATION,
        storeId: STORE,
        customerId: CUSTOMER,
        number: "2030-0002",
        status: "confirmed",
        startDate: new Date(START),
        endDate: new Date(END),
        subtotalAmount: "20.00",
        depositAmount: "50.00",
        totalAmount: "70.00",
        currency: "GBP",
        source: "manual",
      });
    });

    after(async () => {
      await louezDb?.db.$client.end();
      await database?.drop();
    });

    beforeEach(async () => {
      await louezDb.db.delete(louezDb.apiEffects);
      provider.length = 0;
      transport.configured = false;
    });

    /** The acceptance e-mail a confirmation queues, as `buildStatusChangeEffects` writes it. */
    const accepted = (): ApiEffect => ({
      type: "reservation.customerMessage",
      orderingKey: `reservation:${RESERVATION}:customer:email`,
      reservationId: RESERVATION,
      customerId: CUSTOMER,
      payload: {
        channel: "email",
        notification: "customer_request_accepted",
        store: {
          id: STORE,
          name: "Kayaks",
          slug: "status-inbox",
          email: null,
          phone: null,
          address: null,
          logoUrl: null,
          darkLogoUrl: null,
          theme: null,
          settings: null,
          emailSettings: null,
          customerNotificationSettings: null,
          hasTerms: false,
        },
        customer: { id: CUSTOMER, firstName: "Ada", lastName: "Lovelace", email: TO, phone: null },
        reservation: {
          id: RESERVATION,
          number: "2030-0002",
          startDate: START,
          endDate: END,
          totalAmount: "70.00",
          subtotalAmount: "20.00",
          depositAmount: "50.00",
          taxRate: null,
          subtotalExclTax: null,
          taxAmount: null,
          locale: "en",
          currency: "GBP",
        },
        items: [{ name: "Sea kayak", quantity: 2, unitPrice: "10.00", totalPrice: "20.00" }],
        rejectionReason: null,
      },
    });

    /** Adds the row in a transaction, as the status change does, and dispatches it once. */
    const dispatchOne = async () => {
      const [id] = await louezDb.db.transaction((tx) =>
        outbox.enqueueEffects(tx, STORE, [accepted()]),
      );
      assert.ok(id);
      await outbox.dispatchEffects([id], senders);
      const [row] = await outbox.readEffects([id]);
      assert.ok(row);
      return row;
    };

    const unsent = async () => {
      const [store] = await louezDb.db
        .select()
        .from(louezDb.stores)
        .where(eq(louezDb.stores.id, STORE));
      assert.ok(store);
      const { items } = await inbox.listInbox(
        {
          store,
          urls: testUrls.createTestUrls(),
          hostedBy: null,
          reads: { reservations: true, customers: true, products: true },
          operationsOf: null,
        },
        { types: ["message_not_sent"] },
        // Past the hold back every item waits, whatever this machine's clock.
        { now: new Date(Date.now() + 60 * 60_000) },
      );
      return items;
    };

    test("given up after one attempt, kept, and listed in the inbox with why", async () => {
      const row = await dispatchOne();
      assert.equal(row.status, "abandoned");
      assert.equal(row.attempts, 1);
      assert.match(row.lastError ?? "", /^Abandoned: email_not_configured:/);
      assert.notDeepEqual(row.payload, {});
      assert.deepEqual(provider, [], "no provider was called");

      const [item] = (await unsent()).filter((entry) => entry.id === `message_not_sent:${row.id}`);
      assert.ok(item, "the inbox lists it");
      assert.equal(item.details.reason, "email_not_configured");
      assert.match(
        item.summary,
        /^The acceptance message \(email\) to the customer of .+ was not sent \(no e-mail service is set up\): contact the customer yourself\.$/,
      );
    });

    test("with an e-mail service, the same row goes out once and the inbox stays empty", async () => {
      transport.configured = true;
      const row = await dispatchOne();
      assert.equal(row.status, "sent");
      assert.equal(row.attempts, 1);
      assert.deepEqual(provider, [{ event: "customer_request_accepted", channel: "email" }]);
      assert.deepEqual(await unsent(), []);
    });
  },
);
