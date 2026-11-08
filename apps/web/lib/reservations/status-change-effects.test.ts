import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, beforeEach, describe, test } from "node:test";

import type { ApiEvent } from "@louez/api";

import type { StatusChangeEffectDeps } from "./status-change-effects";

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

// What follows a committed status change in the app, with fake senders that
// note each call: nothing leaves the machine and no database is read.

type StatusChanged = Extract<ApiEvent, { type: "reservation.statusChanged" }>;

const store = {
  id: "store",
  userId: "owner",
  name: "Kayaks",
  slug: "kayaks",
  email: "store@example.test",
  phone: null,
  address: null,
  logoUrl: null,
  darkLogoUrl: null,
  theme: null,
  settings: { currency: "EUR" },
  emailSettings: null,
  customerNotificationSettings: null,
  notificationSettings: null,
  discordWebhookUrl: null,
  ownerPhone: null,
  cgv: "Terms",
};

const reservation = {
  id: "res",
  number: "2030-0001",
  startDate: new Date("2030-06-01T09:00:00Z"),
  endDate: new Date("2030-06-03T09:00:00Z"),
  totalAmount: "70.00",
  subtotalAmount: "20.00",
  depositAmount: "50.00",
  taxRate: null,
  subtotalExclTax: null,
  taxAmount: null,
  customer: {
    id: "cus",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    phone: null,
  },
  items: [
    {
      quantity: 1,
      unitPrice: "20.00",
      totalPrice: "20.00",
      productSnapshot: { name: "Kayak", description: null, images: [] },
    },
  ],
};

const event = (overrides: Partial<StatusChanged>): StatusChanged => ({
  type: "reservation.statusChanged",
  store: { id: "store", name: "Kayaks", slug: "kayaks", ownerUserId: "owner" },
  transport: "rpc",
  reservationId: "res",
  from: "pending",
  to: "confirmed",
  rejectionReason: null,
  warningCount: 0,
  ...overrides,
});

describe("status change effects", () => {
  let calls: Array<[string, unknown[]]> = [];
  let failures: unknown[] = [];

  const note =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, args]);
    };

  const deps: Partial<StatusChangeEffectDeps> = {
    // Fixtures shaped as the loaders' rows.
    loadStore: (async () => store) as unknown as StatusChangeEffectDeps["loadStore"],
    loadReservation: (async () =>
      reservation) as unknown as StatusChangeEffectDeps["loadReservation"],
    createReservationInstantAccessUrl: async (...args) => {
      calls.push(["createReservationInstantAccessUrl", args]);
      return "https://kayaks.example.test/contract";
    },
    dispatchCustomerNotification: async (...args) => {
      calls.push(["dispatchCustomerNotification", args]);
      return { email: { sent: true }, sms: { sent: false } };
    },
    dispatchNotification: async (...args) => {
      calls.push(["dispatchNotification", args]);
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
    log: { error: (failure) => failures.push(failure) },
  };
  let createStatusChangeEffects: typeof import("./status-change-effects").createStatusChangeEffects;
  let run: ReturnType<typeof createStatusChangeEffects>;

  before(async () => {
    ({ createStatusChangeEffects } = await import("./status-change-effects"));
    run = createStatusChangeEffects(deps);
  });

  beforeEach(() => {
    calls = [];
    failures = [];
  });

  const names = () => calls.map(([name]) => name);
  const argsOf = (name: string) => calls.find(([called]) => called === name)?.[1] ?? [];

  test("an accepted request emails the customer with the contract link, and notifies the store", async () => {
    await run(event({}));
    assert.deepEqual(names(), [
      "createReservationInstantAccessUrl",
      "dispatchCustomerNotification",
      "dispatchNotification",
      "notifyReservationConfirmed",
      "captureReservationActionSucceeded",
    ]);
    const [notification, context] = argsOf("dispatchCustomerNotification") as [
      string,
      { contractUrl: string; termsUrl: string | null; items: Array<{ name: string }> },
    ];
    assert.equal(notification, "customer_request_accepted");
    assert.equal(context.contractUrl, "https://kayaks.example.test/contract");
    assert.ok(context.termsUrl, "the store has terms");
    assert.deepEqual(
      context.items.map((item) => item.name),
      ["Kayak"],
    );
    assert.equal(argsOf("dispatchNotification")[0], "reservation_confirmed");
  });

  test("a rejection sends the reason to the customer", async () => {
    await run(event({ to: "rejected", rejectionReason: "Fully booked" }));
    const [notification, context] = argsOf("dispatchCustomerNotification") as [
      string,
      { reason?: string },
    ];
    assert.equal(notification, "customer_request_rejected");
    assert.equal(context.reason, "Fully booked");
    assert.equal(argsOf("dispatchNotification")[0], "reservation_rejected");
    assert.ok(names().includes("notifyReservationRejected"));
  });

  test("a cancellation notifies the store, never the customer, and counts as a cancel", async () => {
    await run(event({ from: "confirmed", to: "cancelled", transport: "mcp" }));
    assert.ok(!names().includes("dispatchCustomerNotification"));
    assert.equal(argsOf("dispatchNotification")[0], "reservation_cancelled");
    assert.ok(names().includes("notifyReservationCancelled"));
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

  test("a pick-up and a return notify the store only", async () => {
    await run(event({ from: "confirmed", to: "ongoing" }));
    await run(event({ from: "ongoing", to: "completed" }));
    assert.ok(!names().includes("dispatchCustomerNotification"));
    assert.deepEqual(
      calls.filter(([name]) => name === "dispatchNotification").map(([, args]) => args[0]),
      ["reservation_picked_up", "reservation_completed"],
    );
  });

  test("a failed message is logged and the rest still runs", async () => {
    const failing = createStatusChangeEffects({
      ...deps,
      dispatchCustomerNotification: async () => {
        throw new Error("smtp down");
      },
    });
    await failing(event({}));
    assert.equal(failures.length, 1);
    assert.ok(names().includes("dispatchNotification"));
  });
});
