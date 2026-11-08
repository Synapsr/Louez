import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, beforeEach, describe, test } from "node:test";

import type { ApiEffectPayloads } from "@louez/api/platform/effects";

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
// they send the frozen payload, read nothing of the reservation, and fail the
// row only when nothing went out.

type CustomerMessage = ApiEffectPayloads["reservation.customerMessage"];
type ChannelResult = { sent: boolean; error?: string };

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
  notification: "customer_request_accepted",
  store,
  customer: {
    id: "cus",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    phone: null,
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
  let customerResult: { email: ChannelResult; sms: ChannelResult } = {
    email: { sent: true },
    sms: { sent: false },
  };

  const note =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, args]);
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
    dispatchCustomerNotification: async (event, ctx) => {
      calls.push(["dispatchCustomerNotification", [event, ctx]]);
      return customerResult;
    },
    dispatchNotification: async (event, ctx) => {
      calls.push(["dispatchNotification", [event, ctx]]);
      return {
        email: { sent: true },
        sms: { sent: false },
        discord: { sent: false },
        push: { sent: false },
      };
    },
    notifyReservationConfirmed: note("notifyReservationConfirmed"),
    notifyReservationRejected: note("notifyReservationRejected"),
    notifyEquipmentPickedUp: note("notifyEquipmentPickedUp"),
    notifyReservationCompleted: note("notifyReservationCompleted"),
    notifyReservationCancelled: note("notifyReservationCancelled"),
    captureReservationActionSucceeded: note("captureReservationActionSucceeded"),
  };

  let senders: ReturnType<typeof import("./status-change-effects").createReservationEffectSenders>;

  before(async () => {
    const { createReservationEffectSenders } = await import("./status-change-effects");
    senders = createReservationEffectSenders(deps);
  });

  beforeEach(() => {
    calls = [];
    customerResult = { email: { sent: true }, sms: { sent: false } };
  });

  const argsOf = (name: string) => calls.find(([called]) => called === name)?.[1] ?? [];

  test("an accepted request sends the frozen message, with the contract link", async () => {
    await senders["reservation.customerMessage"](message());
    const [event, ctx] = argsOf("dispatchCustomerNotification") as [
      string,
      {
        contractUrl: string;
        termsUrl: string | null;
        customer: { email: string };
        reservation: { locale?: string | null; startDate: Date };
        items: Array<{ name: string; totalPrice: number }>;
      },
    ];
    assert.equal(event, "customer_request_accepted");
    assert.equal(ctx.contractUrl, "https://kayaks.example.test/contract");
    assert.ok(ctx.termsUrl);
    assert.equal(ctx.customer.email, "ada@example.test");
    assert.equal(ctx.reservation.locale, "de", "the language frozen with the message");
    assert.equal(ctx.reservation.startDate.toISOString(), "2030-06-01T09:00:00.000Z");
    assert.deepEqual(ctx.items, [{ name: "Kayak", quantity: 1, unitPrice: 20, totalPrice: 20 }]);
  });

  test("a rejection sends its reason", async () => {
    await senders["reservation.customerMessage"](
      message({ notification: "customer_request_rejected", rejectionReason: "Fully booked" }),
    );
    const [event, ctx] = argsOf("dispatchCustomerNotification") as [string, { reason?: string }];
    assert.equal(event, "customer_request_rejected");
    assert.equal(ctx.reason, "Fully booked");
    assert.equal(argsOf("createReservationInstantAccessUrl").length, 0);
  });

  test("a message that went out nowhere fails, so the row is retried", async () => {
    customerResult = { email: { sent: false, error: "smtp down" }, sms: { sent: false } };
    await assert.rejects(senders["reservation.customerMessage"](message()), /smtp down/);
    // Channels the store turned off are not a failure.
    customerResult = { email: { sent: false }, sms: { sent: false } };
    await senders["reservation.customerMessage"](message());
  });

  test("the store's notification reads its routing when it goes out", async () => {
    await senders["reservation.storeNotification"]({
      event: "reservation_cancelled",
      storeId: "store",
      reservation: {
        id: "res",
        number: "2030-0001",
        startDate: "2030-06-01T09:00:00.000Z",
        endDate: "2030-06-03T09:00:00.000Z",
        totalAmount: "70.00",
      },
      customer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test", phone: null },
    });
    assert.deepEqual(argsOf("loadStoreRouting"), ["store"]);
    assert.equal(argsOf("dispatchNotification")[0], "reservation_cancelled");
  });

  test("the platform's notification and the analytics event", async () => {
    await senders["reservation.platformNotification"]({
      kind: "completed",
      store: { id: "store", name: "Kayaks", slug: "kayaks" },
      number: "2030-0001",
      totalAmount: "70.00",
      currency: "EUR",
    });
    assert.deepEqual(argsOf("notifyReservationCompleted").slice(1), ["2030-0001", 70, "EUR"]);

    await senders["reservation.statusAnalytics"]({
      ownerUserId: "owner",
      storeId: "store",
      reservationId: "res",
      from: "confirmed",
      to: "cancelled",
      transport: "mcp",
      warningCount: 0,
    });
    const [analytics] = argsOf("captureReservationActionSucceeded") as [
      { action: string; properties: Record<string, unknown> },
    ];
    assert.equal(analytics.action, "cancel_reservation");
    assert.deepEqual(analytics.properties, {
      status_before: "confirmed",
      status_after: "cancelled",
      actor: "mcp",
      surface: "mcp",
    });
  });
});
