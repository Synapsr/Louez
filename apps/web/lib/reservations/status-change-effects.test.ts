import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, beforeEach, describe, test } from "node:test";

import type { ApiEffectPayloads, EffectSendContext } from "@louez/api/platform/effects";

import type { ReservationEffectDeps } from "./status-change-effects";

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// The senders' modules import "server-only", which throws outside Next.
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

// The senders of a reservation's outbox rows, with fakes that note each call:
// each sends one channel of the frozen payload, checks its claim before the
// provider, and passes the strict sender's failure or skip through.

type CustomerMessage = ApiEffectPayloads["reservation.customerMessage"];

const store: CustomerMessage["store"] = {
  id: "store",
  name: "Kayaks",
  slug: "kayaks",
  email: "store@example.test",
  phone: null,
  address: null,
  logoUrl: null,
  darkLogoUrl: null,
  theme: null,
  settings: null,
  emailSettings: null,
  customerNotificationSettings: null,
  hasTerms: true,
};

const message = (overrides: Partial<CustomerMessage> = {}): CustomerMessage => ({
  channel: "email",
  notification: "customer_request_accepted",
  store,
  customer: {
    id: "cus",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    phone: "+33600000001",
  },
  reservation: {
    id: "res",
    number: "2030-0001",
    startDate: "2030-06-01T09:00:00.000Z",
    endDate: "2030-06-03T09:00:00.000Z",
    totalAmount: "70.00",
    subtotalAmount: "20.00",
    depositAmount: "50.00",
    taxRate: null,
    subtotalExclTax: null,
    taxAmount: null,
    locale: "de",
  },
  items: [{ name: "Kayak", quantity: 1, unitPrice: "20.00", totalPrice: "20.00" }],
  rejectionReason: null,
  ...overrides,
});

describe("reservation effect senders", () => {
  let calls: Array<[string, unknown[]]> = [];
  let claimChecks = 0;
  let failWith: Error | null = null;

  const context: EffectSendContext = {
    effectId: "effect_test",
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    assertClaim: async () => {
      claimChecks += 1;
    },
  };

  const deps: Partial<ReservationEffectDeps> = {
    loadStoreRouting: async (storeId: string) => {
      calls.push(["loadStoreRouting", [storeId]]);
      return {
        id: storeId,
        name: "Kayaks",
        email: "store@example.test",
        discordWebhookUrl: null,
        ownerPhone: null,
        notificationSettings: null,
        settings: null,
      };
    },
    createReservationInstantAccessUrl: async (params) => {
      calls.push(["createReservationInstantAccessUrl", [params]]);
      return "https://kayaks.example.test/contract";
    },
    sendCustomerNotificationChannel: async (event, ctx, channel, beforeSend, deliveryKey) => {
      await beforeSend();
      calls.push(["sendCustomerNotificationChannel", [event, ctx, channel, deliveryKey]]);
      if (failWith) throw failWith;
      return undefined;
    },
    sendStoreNotificationChannel: async (event, ctx, channel, beforeSend, deliveryKey) => {
      await beforeSend();
      calls.push(["sendStoreNotificationChannel", [event, ctx, channel, deliveryKey]]);
      return { skipped: "the store turned it off" };
    },
    sendPlatformReservationStatus: async (channel, kind, input, beforeSend) => {
      await beforeSend();
      calls.push(["sendPlatformReservationStatus", [channel, kind, input]]);
      return undefined;
    },
    captureReservationActionSucceededOrThrow: async (event) => {
      calls.push(["captureReservationActionSucceededOrThrow", [event]]);
    },
  };

  let senders: ReturnType<typeof import("./status-change-effects").createReservationEffectSenders>;

  before(async () => {
    const { createReservationEffectSenders } = await import("./status-change-effects");
    senders = createReservationEffectSenders(deps);
  });

  beforeEach(() => {
    calls = [];
    claimChecks = 0;
    failWith = null;
  });

  const argsOf = (name: string) => calls.find(([called]) => called === name)?.[1] ?? [];

  test("an acceptance email sends the frozen message, with the contract link", async () => {
    await senders["reservation.customerMessage"](message(), context);
    const [event, ctx, channel] = argsOf("sendCustomerNotificationChannel") as [
      string,
      {
        contractUrl?: string;
        termsUrl: string | null;
        customer: { email: string };
        reservation: { locale?: string | null; startDate: Date };
        items: Array<{ name: string; totalPrice: number }>;
      },
      string,
    ];
    assert.equal(event, "customer_request_accepted");
    assert.equal(channel, "email");
    assert.equal(ctx.contractUrl, "https://kayaks.example.test/contract");
    assert.ok(ctx.termsUrl);
    assert.equal(ctx.reservation.locale, "de", "the language frozen with the message");
    assert.equal(ctx.reservation.startDate.toISOString(), "2030-06-01T09:00:00.000Z");
    assert.deepEqual(ctx.items, [{ name: "Kayak", quantity: 1, unitPrice: 20, totalPrice: 20 }]);
    assert.equal(claimChecks, 1, "the claim is checked before the provider");
  });

  test("an SMS sends its own channel, without a contract link", async () => {
    await senders["reservation.customerMessage"](message({ channel: "sms" }), context);
    assert.equal(argsOf("sendCustomerNotificationChannel")[2], "sms");
    assert.deepEqual(argsOf("createReservationInstantAccessUrl"), []);
  });

  test("a rejection sends its reason, and a failure reaches the outbox", async () => {
    await senders["reservation.customerMessage"](
      message({ notification: "customer_request_rejected", rejectionReason: "Fully booked" }),
      context,
    );
    const [event, ctx] = argsOf("sendCustomerNotificationChannel") as [string, { reason?: string }];
    assert.equal(event, "customer_request_rejected");
    assert.equal(ctx.reason, "Fully booked");

    failWith = new Error("smtp down");
    await assert.rejects(senders["reservation.customerMessage"](message(), context), /smtp down/);
  });

  test("a store's cancellation sends the cancellation message, with its items, never a contract", async () => {
    for (const channel of ["email", "sms"] as const) {
      calls = [];
      await senders["reservation.customerMessage"](
        message({ notification: "customer_reservation_cancelled", channel }),
        context,
      );
      const [event, ctx, sentOn, deliveryKey] = argsOf("sendCustomerNotificationChannel") as [
        string,
        {
          contractUrl?: string;
          storefrontUrl?: string;
          reason?: string;
          reservation: { number: string; locale?: string | null };
          items: Array<{ name: string; quantity: number }>;
        },
        string,
        string,
      ];
      assert.equal(event, "customer_reservation_cancelled");
      assert.equal(deliveryKey, "effect_test", "keyed by its outbox row, across retries");
      assert.equal(sentOn, channel);
      assert.equal(ctx.reservation.number, "2030-0001");
      assert.equal(ctx.reservation.locale, "de");
      assert.deepEqual(
        ctx.items.map((item) => [item.name, item.quantity]),
        [["Kayak", 1]],
      );
      assert.ok(ctx.storefrontUrl, "the online store, to book again");
      assert.equal(ctx.contractUrl, undefined);
      assert.equal(ctx.reason, undefined);
      assert.deepEqual(argsOf("createReservationInstantAccessUrl"), []);
    }
  });

  test("the store's notification reads its routing when it goes out, and passes a skip", async () => {
    const outcome = await senders["reservation.storeNotification"](
      {
        channel: "discord",
        event: "reservation_cancelled",
        actor: "store",
        storeId: "store",
        reservation: {
          id: "res",
          number: "2030-0001",
          startDate: "2030-06-01T09:00:00.000Z",
          endDate: "2030-06-03T09:00:00.000Z",
          totalAmount: "70.00",
          currency: "GBP",
        },
        customer: {
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.test",
          phone: null,
        },
      },
      context,
    );
    assert.deepEqual(argsOf("loadStoreRouting"), ["store"]);
    assert.deepEqual(argsOf("sendStoreNotificationChannel").slice(0, 1), ["reservation_cancelled"]);
    assert.equal(argsOf("sendStoreNotificationChannel")[2], "discord");
    assert.equal(argsOf("sendStoreNotificationChannel")[3], "effect_test", "keyed by its row");
    // The store's own change, in the reservation's currency: the dispatcher emails no one
    // for it, and prices it as the customer paid.
    const ctx = argsOf("sendStoreNotificationChannel")[1] as {
      actor: string;
      reservation: { currency?: string | null; totalAmount: number };
    };
    assert.equal(ctx.actor, "store");
    assert.equal(ctx.reservation.currency, "GBP");
    assert.equal(ctx.reservation.totalAmount, 70);
    assert.deepEqual(outcome, { skipped: "the store turned it off" });
  });

  test("the platform's notification and the analytics event", async () => {
    await senders["reservation.platformNotification"](
      {
        channel: "fromhello",
        kind: "completed",
        store: { id: "store", name: "Kayaks", slug: "kayaks" },
        number: "2030-0001",
        totalAmount: "70.00",
        currency: "EUR",
      },
      context,
    );
    assert.deepEqual(argsOf("sendPlatformReservationStatus"), [
      "fromhello",
      "completed",
      {
        store: { id: "store", name: "Kayaks", slug: "kayaks" },
        number: "2030-0001",
        totalAmount: 70,
        currency: "EUR",
      },
    ]);

    await senders["reservation.statusAnalytics"](
      {
        eventUuid: "0190f3f0-5b6e-7c3a-9d2e-1a2b3c4d5e6f",
        occurredAt: "2026-11-08T10:00:00.000Z",
        ownerUserId: "owner",
        storeId: "store",
        reservationId: "res",
        from: "confirmed",
        to: "cancelled",
        transport: "mcp",
        warningCount: 0,
      },
      context,
    );
    const [analytics] = argsOf("captureReservationActionSucceededOrThrow") as [
      { action: string; properties: Record<string, unknown>; identity: unknown },
    ];
    assert.equal(analytics.action, "cancel_reservation");
    // The row's event id and time, the same on every retry.
    assert.deepEqual(analytics.identity, {
      eventUuid: "0190f3f0-5b6e-7c3a-9d2e-1a2b3c4d5e6f",
      occurredAt: "2026-11-08T10:00:00.000Z",
    });
    assert.deepEqual(analytics.properties, {
      status_before: "confirmed",
      status_after: "cancelled",
      actor: "mcp",
      surface: "mcp",
    });
  });
});
