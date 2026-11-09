import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, describe, test } from "node:test";

import { render } from "@react-email/render";

import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_EVENTS_WITH_OWNER_EMAIL,
  NOTIFICATION_EVENT_TYPES,
  type NotificationEventType,
  type NotificationSettings,
} from "@louez/types";

import type { EmailLocale } from "@/lib/email/i18n";
import type { PaymentAdminEmailKind, StatusChangeAdminEmailKind } from "@/lib/email/templates";

import type { AdminEmailDeps, AdminEmailStore } from "./admin-email";
import type { NotificationActor, NotificationContext } from "./dispatcher";

// The owner's email per event: which events have one, who receives it, and that
// the store's email setting decides whether dispatchNotification sends it. The
// senders are fakes, so nothing leaves the machine.

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

let adminEmail: typeof import("./admin-email");
let dispatcher: typeof import("./dispatcher");
let templates: typeof import("@/lib/email/templates");

before(async () => {
  adminEmail = await import("./admin-email");
  dispatcher = await import("./dispatcher");
  templates = await import("@/lib/email/templates");
});

const sendAdminEventEmail: typeof import("./admin-email").sendAdminEventEmail = (...args) =>
  adminEmail.sendAdminEventEmail(...args);
const hasAdminEmail = (event: NotificationEventType) => adminEmail.hasAdminEmail(event);
const dispatchNotification: typeof import("./dispatcher").dispatchNotification = (...args) =>
  dispatcher.dispatchNotification(...args);

const STORE: AdminEmailStore = {
  id: "store_admin_email",
  name: "Vélos du port",
  email: "contact@velos.test",
  logoUrl: null,
  darkLogoUrl: null,
  phone: null,
  address: null,
  theme: null,
  settings: {
    reservationMode: "payment",
    advanceNoticeMinutes: 0,
    country: "FR",
    currency: "EUR",
    timezone: "Europe/Paris",
  },
};

const ctx = (overrides: Partial<NotificationContext> = {}): NotificationContext => ({
  actor: "customer",
  store: { id: STORE.id, name: STORE.name, email: STORE.email },
  reservation: {
    id: "res_1",
    number: "R-1001",
    startDate: new Date("2027-05-01T08:00:00Z"),
    endDate: new Date("2027-05-03T08:00:00Z"),
    totalAmount: 120,
    customerNotes: "Arrivée vers 9h",
  },
  customer: { firstName: "Léa", lastName: "Martin", email: "lea@example.test" },
  payment: { amount: 80 },
  ...overrides,
});

interface Sent {
  newRequest: Parameters<AdminEmailDeps["sendNewRequestLandlordEmail"]>[0][];
  payment: Parameters<AdminEmailDeps["sendPaymentAdminEmail"]>[0][];
  statusChange: Parameters<AdminEmailDeps["sendStatusChangeAdminEmail"]>[0][];
}

const noneSent = (): Sent => ({ newRequest: [], payment: [], statusChange: [] });

const fakeDeps = (
  sent: Sent,
  options: { store?: AdminEmailStore | null; ownerEmail?: string | null; fail?: boolean } = {},
): AdminEmailDeps => ({
  loadStore: async () => (options.store === undefined ? STORE : options.store),
  findOwnerEmail: async () => options.ownerEmail ?? null,
  sendNewRequestLandlordEmail: async (input) => {
    sent.newRequest.push(input);
    if (options.fail) throw new Error("smtp down");
    return { success: true };
  },
  sendPaymentAdminEmail: async (input) => {
    sent.payment.push(input);
    if (options.fail) throw new Error("smtp down");
    return { success: true };
  },
  sendStatusChangeAdminEmail: async (input) => {
    sent.statusChange.push(input);
    if (options.fail) throw new Error("smtp down");
    return { success: true };
  },
});

describe("owner email per event", () => {
  test("rejections, pickups and completions, the owner's own actions, have no email", () => {
    const withEmail: NotificationEventType[] = [
      "reservation_new",
      "reservation_confirmed",
      "reservation_cancelled",
      "payment_received",
      "payment_failed",
      "payment_disputed",
    ];
    for (const event of withEmail) assert.equal(hasAdminEmail(event), true, event);
    for (const event of [
      "reservation_rejected",
      "reservation_picked_up",
      "reservation_completed",
    ] as const) {
      assert.equal(hasAdminEmail(event), false, event);
    }
  });

  test("the settings show an email toggle exactly where an email can reach the owner", () => {
    const reminders: NotificationEventType[] = [
      "reservation_reminder_pickup",
      "reservation_reminder_return",
    ];
    for (const event of NOTIFICATION_EVENT_TYPES) {
      assert.equal(
        NOTIFICATION_EVENTS_WITH_OWNER_EMAIL.includes(event),
        hasAdminEmail(event) || reminders.includes(event),
        event,
      );
    }
  });

  test("a paid reservation emails the store with the amount paid, in its language", async () => {
    const sent = noneSent();
    const result = await sendAdminEventEmail("payment_received", ctx(), fakeDeps(sent));

    assert.deepEqual(result, { sent: true });
    assert.equal(sent.newRequest.length, 0);
    assert.equal(sent.payment.length, 1);
    const [email] = sent.payment;
    assert.equal(email?.to, "contact@velos.test");
    assert.equal(email?.kind, "received");
    assert.equal(email?.amount, 80);
    assert.equal(email?.locale, "fr");
    assert.match(email?.dashboardUrl ?? "", /\/dashboard\/reservations\/res_1$/);
  });

  test("a failed payment without a customer still emails the owner", async () => {
    const sent = noneSent();
    const result = await sendAdminEventEmail(
      "payment_failed",
      ctx({ customer: undefined }),
      fakeDeps(sent),
    );

    assert.deepEqual(result, { sent: true });
    assert.equal(sent.payment[0]?.kind, "failed");
    assert.equal(sent.payment[0]?.customer, undefined);
  });

  test("a disputed payment emails the owner with the disputed amount", async () => {
    const sent = noneSent();
    const result = await sendAdminEventEmail("payment_disputed", ctx(), fakeDeps(sent));

    assert.deepEqual(result, { sent: true });
    assert.equal(sent.payment[0]?.kind, "disputed");
    assert.equal(sent.payment[0]?.amount, 80);
  });

  test("a new request sends the new request email with the customer's message", async () => {
    const sent = noneSent();
    await sendAdminEventEmail("reservation_new", ctx(), fakeDeps(sent));

    assert.equal(sent.payment.length, 0);
    assert.equal(sent.newRequest[0]?.reservation.customerNotes, "Arrivée vers 9h");
  });

  test("a store without an address emails its owner's account", async () => {
    const sent = noneSent();
    const result = await sendAdminEventEmail(
      "payment_received",
      ctx(),
      fakeDeps(sent, { store: { ...STORE, email: null }, ownerEmail: "owner@velos.test" }),
    );

    assert.deepEqual(result, { sent: true });
    assert.equal(sent.payment[0]?.to, "owner@velos.test");
  });

  test("an event without an owner email is reported as not sent", async () => {
    const sent = noneSent();
    const result = await sendAdminEventEmail("reservation_rejected", ctx(), fakeDeps(sent));

    assert.equal(result.sent, false);
    assert.deepEqual(sent, noneSent());
  });

  test("a confirmation or a cancellation the customer made emails the owner", async () => {
    const sent = noneSent();
    const base = ctx();
    const reservation = base.reservation && { ...base.reservation, currency: "GBP" };
    assert.deepEqual(
      await sendAdminEventEmail("reservation_confirmed", ctx({ reservation }), fakeDeps(sent)),
      { sent: true },
    );
    assert.deepEqual(
      await sendAdminEventEmail("reservation_cancelled", ctx({ reservation }), fakeDeps(sent)),
      { sent: true },
    );
    assert.deepEqual(
      await sendAdminEventEmail(
        "reservation_cancelled",
        ctx({ reservation, quoteDeclined: true }),
        fakeDeps(sent),
      ),
      { sent: true },
    );
    assert.deepEqual(
      sent.statusChange.map((email) => [email.kind, email.to, email.reservationCurrency]),
      [
        ["confirmed", "contact@velos.test", "GBP"],
        ["cancelled", "contact@velos.test", "GBP"],
        ["quote_declined", "contact@velos.test", "GBP"],
      ],
    );
  });

  test("the store's own changes, and the system's, send the owner no email", async () => {
    const sent = noneSent();
    const actors: NotificationActor[] = ["store", "system"];
    const events: NotificationEventType[] = ["reservation_confirmed", "reservation_cancelled"];
    for (const actor of actors) {
      for (const event of events) {
        const result = await sendAdminEventEmail(event, ctx({ actor }), fakeDeps(sent));
        assert.equal(result.sent, false, `${actor} ${event}`);
      }
    }
    assert.deepEqual(sent, noneSent());
  });

  test("no recipient, or a failed send, is reported as not sent", async () => {
    const none = await sendAdminEventEmail(
      "payment_received",
      ctx(),
      fakeDeps(noneSent(), { store: { ...STORE, email: null } }),
    );
    assert.equal(none.sent, false);

    const failed = await sendAdminEventEmail(
      "payment_received",
      ctx(),
      fakeDeps(noneSent(), { fail: true }),
    );
    assert.deepEqual(failed, { sent: false, error: "smtp down" });
  });
});

describe("dispatchNotification email channel", () => {
  const settingsWith = (event: NotificationEventType, email: boolean): NotificationSettings => ({
    ...DEFAULT_NOTIFICATION_SETTINGS,
    [event]: { email, sms: false, discord: false, push: false },
  });

  test("sends the owner email when the store keeps the event's email on", async () => {
    const sent: NotificationEventType[] = [];
    const result = await dispatchNotification(
      "payment_received",
      ctx({
        store: {
          id: STORE.id,
          name: STORE.name,
          notificationSettings: settingsWith("payment_received", true),
        },
      }),
      {
        sendAdminEventEmail: async (event) => {
          sent.push(event);
          return { sent: true };
        },
        sendAdminSms: async () => ({ success: false, error: "not used" }),
      },
    );

    assert.deepEqual(sent, ["payment_received"]);
    assert.deepEqual(result.email, { sent: true });
  });

  test("sends nothing when the store turned the event's email off", async () => {
    const sent: NotificationEventType[] = [];
    const result = await dispatchNotification(
      "payment_failed",
      ctx({
        store: {
          id: STORE.id,
          name: STORE.name,
          email: STORE.email,
          notificationSettings: settingsWith("payment_failed", false),
        },
      }),
      {
        sendAdminEventEmail: async (event) => {
          sent.push(event);
          return { sent: true };
        },
        sendAdminSms: async () => ({ success: false, error: "not used" }),
      },
    );

    assert.deepEqual(sent, []);
    assert.deepEqual(result.email, { sent: false });
  });

  test("reports an event without an owner email as not sent", async () => {
    const result = await dispatchNotification(
      "reservation_rejected",
      ctx({
        store: {
          id: STORE.id,
          name: STORE.name,
          email: STORE.email,
          notificationSettings: settingsWith("reservation_rejected", true),
        },
      }),
    );

    assert.equal(result.email.sent, false);
  });
});

describe("status change email to the owner", () => {
  test("renders in every locale, for a confirmation, a cancellation and a declined quote", async () => {
    const locales: EmailLocale[] = [
      "fr",
      "en",
      "de",
      "es",
      "it",
      "nl",
      "pl",
      "pt",
      "zh",
      "ja",
      "ru",
      "id",
      "ko",
    ];
    const kinds: StatusChangeAdminEmailKind[] = ["confirmed", "cancelled", "quote_declined"];
    for (const kind of kinds) {
      for (const locale of locales) {
        const html = await render(
          templates.StatusChangeAdminEmail({
            kind,
            storeName: "Vélos du port",
            customer: { firstName: "Léa", lastName: "Martin", email: "lea@example.test" },
            reservationNumber: "R-1001",
            startDate: new Date("2027-05-01T08:00:00Z"),
            endDate: new Date("2027-05-03T08:00:00Z"),
            reservationTotal: 120,
            dashboardUrl: "https://app.example.test/dashboard/reservations/res_1",
            locale,
            currency: "EUR",
          }),
        );
        assert.match(html, /R-1001/, `${kind} ${locale}`);
        assert.match(html, /Léa/, `${kind} ${locale}`);
        assert.doesNotMatch(html, /\{(number|storeName)\}/, `${kind} ${locale}`);
      }
    }
  });
});

describe("payment currencies", () => {
  test("the amount keeps the payment's currency, the total the reservation's", async () => {
    const sent = noneSent();
    const base = ctx();
    await sendAdminEventEmail(
      "payment_disputed",
      ctx({
        store: { ...base.store, settings: { currency: "EUR" } },
        reservation: base.reservation && { ...base.reservation, currency: "GBP" },
        payment: { amount: 80, currency: "USD" },
      }),
      fakeDeps(sent),
    );
    assert.equal(sent.payment[0]?.amountCurrency, "USD");
    assert.equal(sent.payment[0]?.reservationCurrency, "GBP");
  });

  test("without their own, they fall back to the reservation's, then the store's", async () => {
    const sent = noneSent();
    const base = ctx();
    await sendAdminEventEmail(
      "payment_received",
      ctx({
        store: { ...base.store, settings: { currency: "CHF" } },
        reservation: base.reservation && { ...base.reservation, currency: null },
        payment: { amount: 80 },
      }),
      fakeDeps(sent),
    );
    assert.equal(sent.payment[0]?.amountCurrency, "CHF");
    assert.equal(sent.payment[0]?.reservationCurrency, "CHF");
  });

  test("the email formats each amount in its own currency", async () => {
    const html = await render(
      templates.PaymentAdminEmail({
        kind: "disputed",
        storeName: "Vélos du port",
        reservationNumber: "R-1001",
        startDate: new Date("2027-05-01T08:00:00Z"),
        endDate: new Date("2027-05-03T08:00:00Z"),
        amount: 80,
        reservationTotal: 120,
        dashboardUrl: "https://app.example.test/dashboard/reservations/res_1",
        locale: "en",
        currency: "EUR",
        amountCurrency: "USD",
      }),
    );
    assert.match(html, /\$80\.00/);
    assert.match(html, /€120\.00/);
  });
});

describe("payment email to the owner", () => {
  const locales: EmailLocale[] = [
    "fr",
    "en",
    "de",
    "es",
    "it",
    "nl",
    "pl",
    "pt",
    "zh",
    "ja",
    "ru",
    "id",
    "ko",
  ];

  for (const kind of ["received", "failed", "disputed"] satisfies PaymentAdminEmailKind[]) {
    test(`${kind}: renders in every locale with the amount`, async () => {
      for (const locale of locales) {
        const html = await render(
          templates.PaymentAdminEmail({
            kind,
            storeName: "Vélos du port",
            customer:
              kind === "received"
                ? { firstName: "Léa", lastName: "Martin", email: "lea@example.test" }
                : null,
            reservationNumber: "R-1001",
            startDate: new Date("2027-05-01T08:00:00Z"),
            endDate: new Date("2027-05-03T08:00:00Z"),
            amount: 80,
            reservationTotal: 120,
            dashboardUrl: "https://app.example.test/dashboard/reservations/res_1",
            locale,
            currency: "EUR",
          }),
        );
        assert.match(html, /R-1001/, locale);
        assert.match(html, /80/, locale);
        assert.doesNotMatch(html, /\{(number|storeName)\}/, locale);
        assert.equal(html.includes("Léa"), kind === "received", locale);
      }
    });
  }
});
