import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, describe, test } from "node:test";

import { DEFAULT_NOTIFICATION_SETTINGS } from "@louez/types";

import type { NotificationContext, NotificationResult } from "@/lib/notifications/dispatcher";

import type { DisputeNotificationDeps } from "./dispute-notification";

// The dispute alert is retried in the request when nothing reached the owner,
// and never resent once a channel worked. The dispatcher is a fake.

// The email logo helper imports "server-only", which throws outside Next.
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

let notification: typeof import("./dispute-notification");
let dispatcher: typeof import("@/lib/notifications/dispatcher");

before(async () => {
  notification = await import("./dispute-notification");
  dispatcher = await import("@/lib/notifications/dispatcher");
});

const INPUT = { reservationId: "res_dispute", amount: 100, currency: "EUR" };

const CTX: NotificationContext = {
  actor: "system",
  store: { id: "store_dispute", name: "Vélos du port" },
  reservation: {
    id: "res_dispute",
    number: "R-1",
    startDate: new Date("2027-05-01T08:00:00Z"),
    endDate: new Date("2027-05-03T08:00:00Z"),
    totalAmount: 100,
  },
  payment: { amount: 100, currency: "EUR" },
};

const result = (overrides: Partial<NotificationResult> = {}): NotificationResult => ({
  email: { sent: false },
  sms: { sent: false },
  discord: { sent: false },
  push: { sent: false },
  ...overrides,
});

const deps = (outcomes: Array<NotificationResult | Error>, budgetMs = 20_000) => {
  const sleeps: number[] = [];
  let dispatches = 0;
  let clock = 0;
  const fake: DisputeNotificationDeps = {
    loadContext: async () => CTX,
    dispatch: async () => {
      const outcome = outcomes[Math.min(dispatches, outcomes.length - 1)];
      dispatches += 1;
      if (!outcome || outcome instanceof Error) throw outcome ?? new Error("no outcome");
      return outcome;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    retryDelaysMs: [1_000, 3_000],
    budgetMs,
  };
  return { fake, sleeps, dispatches: () => dispatches };
};

const failed = result({ email: { sent: false, error: "smtp down" } });

describe("dispute alert retries", () => {
  test("a total failure is retried until a channel reaches the owner", async () => {
    const { fake, sleeps, dispatches } = deps([
      failed,
      new Error("db gone"),
      result({ email: { sent: true } }),
    ]);
    assert.deepEqual(await notification.notifyPaymentDisputed(INPUT, fake), {
      notified: true,
      attempts: 3,
    });
    assert.equal(dispatches(), 3);
    assert.deepEqual(sleeps, [1_000, 3_000]);
  });

  test("it gives up after three attempts", async () => {
    const { fake, dispatches } = deps([failed]);
    assert.deepEqual(await notification.notifyPaymentDisputed(INPUT, fake), {
      notified: false,
      attempts: 3,
    });
    assert.equal(dispatches(), 3);
  });

  test("a partial failure is not retried, so no channel is sent twice", async () => {
    const { fake, dispatches } = deps([
      result({ email: { sent: false, error: "smtp down" }, discord: { sent: true } }),
    ]);
    assert.deepEqual(await notification.notifyPaymentDisputed(INPUT, fake), {
      notified: true,
      attempts: 1,
    });
    assert.equal(dispatches(), 1);
  });

  test("a store with every channel off is not retried", async () => {
    const { fake, dispatches } = deps([result()]);
    assert.deepEqual(await notification.notifyPaymentDisputed(INPUT, fake), {
      notified: false,
      attempts: 1,
    });
    assert.equal(dispatches(), 1);
  });

  test("an attempt that would start past the budget is not made", async () => {
    const { fake, sleeps, dispatches } = deps([failed], 2_000);
    assert.deepEqual(await notification.notifyPaymentDisputed(INPUT, fake), {
      notified: false,
      attempts: 2,
    });
    assert.equal(dispatches(), 2);
    assert.deepEqual(sleeps, [1_000]);
  });

  test("the email sent, then the SMS quota lookup throws: one email, no retry", async () => {
    const emails: string[] = [];
    const { fake, dispatches } = deps([]);
    let smsCalls = 0;
    const store: NotificationContext["store"] = {
      ...CTX.store,
      email: "owner@velos.test",
      ownerPhone: "+33612345678",
      notificationSettings: {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        payment_disputed: { email: true, sms: true, discord: false, push: false },
      },
    };
    const result = await notification.notifyPaymentDisputed(INPUT, {
      ...fake,
      loadContext: async () => ({ ...CTX, store }),
      dispatch: (ctx) =>
        dispatcher.dispatchNotification("payment_disputed", ctx, {
          sendAdminEventEmail: async (event) => {
            emails.push(event);
            return { sent: true };
          },
          sendAdminSms: async () => {
            smsCalls += 1;
            throw new Error("quota lookup failed");
          },
        }),
    });

    assert.deepEqual(result, { notified: true, attempts: 1 });
    assert.deepEqual(emails, ["payment_disputed"]);
    assert.equal(smsCalls, 1);
    assert.equal(dispatches(), 0);
  });

  test("the dispatcher keeps each channel's outcome when another throws", async () => {
    const outcome = await dispatcher.dispatchNotification(
      "payment_disputed",
      {
        ...CTX,
        store: {
          ...CTX.store,
          ownerPhone: "+33612345678",
          notificationSettings: {
            ...DEFAULT_NOTIFICATION_SETTINGS,
            payment_disputed: { email: true, sms: true, discord: false, push: false },
          },
        },
      },
      {
        sendAdminEventEmail: async () => ({ sent: true }),
        sendAdminSms: async () => {
          throw new Error("quota lookup failed");
        },
      },
    );
    assert.deepEqual(outcome.email, { sent: true });
    assert.deepEqual(outcome.sms, { sent: false, error: "quota lookup failed" });
  });
});
