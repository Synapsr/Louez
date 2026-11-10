import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { beforeEach, describe, mock, test } from "node:test";

import type { CustomerNotificationEventType } from "@louez/types";

import { resolveFormatLocale } from "@/lib/i18n/format-locale";

// The SMS a customer gets, end to end from the outbox's sender
// (sendCustomerNotificationChannel) to the provider, which is faked: what it
// receives, how often, and what the outbox is told.

// The senders' modules import "server-only", which throws outside Next.
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

const submissions: Array<{ to: string; message: string }> = [];
const records: Array<{ id: string; messageId: string | null; creditSource: string }> = [];
const queued: Array<{ id: string }> = [];
let recordFailures = 0;

mock.module("@/lib/sms/client", {
  namedExports: {
    isSmsConfigured: () => true,
    sendSms: async (options: { to: string; message: string }) => {
      submissions.push(options);
      return { success: true, messageId: `provider_${submissions.length}` };
    },
  },
});
mock.module("@/lib/sms/delivery-record", {
  namedExports: {
    recordSmsDelivery: async (record: {
      id: string;
      messageId: string | null;
      creditSource: string;
    }) => {
      if (recordFailures > 0) {
        recordFailures -= 1;
        throw new Error("Lock wait timeout exceeded");
      }
      records.push(record);
    },
    queueSmsDeliveryRecord: async (record: { id: string }) => {
      queued.push(record);
    },
    recordSmsFailure: async () => {},
  },
});
mock.module("@/lib/plan-limits", {
  namedExports: {
    getSmsQuotaStatus: async () => ({ allowed: true, current: 0, planLimit: 10, planSlug: "pro" }),
    // Past the month's included SMS: each one is paid from the prepaid balance.
    determineSmsSource: async () => "topup",
  },
});
// The emails are not under test; their modules and the reminder preferences
// import "server-only" through require, which the hook above does not reach.
mock.module("@/lib/notifications/customer-reminder-preferences", {
  namedExports: { getCustomerReminderPreferences: async () => null },
});
mock.module("@/lib/i18n/configured-format-locale", {
  namedExports: { getConfiguredFormatLocale: (locale?: string) => resolveFormatLocale(locale) },
});
const unused = () => {
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
    ].map((name) => [name, unused]),
  ),
});
mock.module("@/lib/evlog", {
  namedExports: { log: { warn: () => {}, error: () => {}, info: () => {} } },
});

const STORE = {
  id: "store_sms",
  name: "Kayaks",
  email: "store@example.test",
  settings: { country: "FR", currency: "EUR" },
};

const context = (
  event: CustomerNotificationEventType,
  overrides: { smsMessage?: string; locale?: string | null } = {},
) => ({
  store: {
    ...STORE,
    customerNotificationSettings:
      overrides.smsMessage === undefined
        ? null
        : ({ templates: { [event]: { smsMessage: overrides.smsMessage } } } as never),
  },
  customer: {
    id: "cus_sms",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    phone: "+33612345678",
  },
  reservation: {
    id: "res_sms",
    number: "2030-0001",
    startDate: new Date("2030-06-01T12:00:00Z"),
    endDate: new Date("2030-06-03T12:00:00Z"),
    totalAmount: 70,
    subtotalAmount: 20,
    depositAmount: 50,
    locale: overrides.locale === undefined ? null : overrides.locale,
  },
  paymentRequestAmount: 20,
  paymentRequestDescription: "Rental",
  paymentRequestUrl: "https://pay.example.test/rent",
  depositAuthorizationAmount: 50,
  depositAuthorizationUrl: "https://pay.example.test/deposit",
});

/** Every event with an SMS. */
const SMS_EVENTS: CustomerNotificationEventType[] = [
  "customer_request_received",
  "customer_request_accepted",
  "customer_request_rejected",
  "customer_reservation_confirmed",
  "customer_reservation_cancelled",
  "customer_reminder_pickup",
  "customer_reminder_return",
  "customer_payment_requested",
  "customer_deposit_authorization_requested",
];

describe("customer SMS", () => {
  let dispatcher: typeof import("@/lib/notifications/customer-dispatcher");

  beforeEach(async () => {
    dispatcher ??= await import("@/lib/notifications/customer-dispatcher");
    submissions.length = 0;
    records.length = 0;
    queued.length = 0;
    recordFailures = 0;
  });

  const send = (event: CustomerNotificationEventType, ctx: ReturnType<typeof context>) =>
    dispatcher.sendCustomerNotificationChannel(event, ctx, "sms", async () => {});

  test("every event sends the store's saved text, its variables filled in", async () => {
    const saved =
      "{storeName}: hello {name}, #{number} from {startDate} to {endDate}. {amount} {paymentUrl} {unknown}";
    for (const event of SMS_EVENTS) {
      submissions.length = 0;
      await send(event, context(event, { smsMessage: saved }));
      assert.equal(submissions.length, 1, event);
      const text = submissions[0]?.message ?? "";
      assert.match(text, /^Kayaks: hello Ada, #2030-0001 from \S+ to \S+\./, event);
      assert.doesNotMatch(text, /\{(storeName|name|number|startDate|endDate)\}/, event);
      assert.match(text, /\{unknown\}$/, `${event}: a variable it does not know stays as written`);
      if (event === "customer_payment_requested") {
        assert.match(text, /20,00\s€ https:\/\/pay\.example\.test\/rent/);
      } else if (event === "customer_deposit_authorization_requested") {
        assert.match(text, /50,00\s€ https:\/\/pay\.example\.test\/deposit/);
      } else {
        assert.match(text, /\{amount\} \{paymentUrl\}/, `${event}: no amount nor link to fill`);
      }
    }
  });

  test("every event sends its default text when the saved one is empty", async () => {
    for (const event of SMS_EVENTS) {
      for (const smsMessage of [undefined, "", "   \n "]) {
        submissions.length = 0;
        await send(event, context(event, { smsMessage }));
        const text = submissions[0]?.message ?? "";
        assert.match(text, /^Kayaks\n/, `${event}: the default opens with the store's name`);
        assert.match(text, /2030-0001/, event);
        assert.doesNotMatch(text, /\{\w+\}/, event);
      }
    }
  });

  test("the SMS speaks the reservation's language, else the store country's", async () => {
    await send(
      "customer_reservation_cancelled",
      context("customer_reservation_cancelled", { locale: "de" }),
    );
    await send("customer_reservation_cancelled", context("customer_reservation_cancelled"));
    await send("customer_request_accepted", context("customer_request_accepted", { locale: "nl" }));
    assert.deepEqual(
      submissions.map((submission) => submission.message),
      [
        "Kayaks\nReservierung #2030-0001 storniert. Bei Fragen kontaktieren Sie uns.",
        "Kayaks\nRéservation #2030-0001 annulée. Contactez-nous pour toute question.",
        "Kayaks\nAanvraag #2030-0001 geaccepteerd! Check je email.",
      ],
    );
  });

  test("the review request sends Review Booster's saved text, else its default", async () => {
    const { sendThankYouReviewSms } = await import("./send");
    const params = {
      store: STORE,
      customer: { id: "cus_sms", firstName: "Ada", lastName: "Lovelace", phone: "+33612345678" },
      reservation: { id: "res_sms", number: "2030-0001" },
      reviewUrl: "https://louez.test/r/kayaks",
      locale: "en" as const,
    };
    await sendThankYouReviewSms({
      ...params,
      customMessage: "{storeName}: thanks {name}! {reviewUrl}",
    });
    await sendThankYouReviewSms({ ...params, customMessage: " " });
    assert.equal(submissions[0]?.message, "Kayaks: thanks Ada! https://louez.test/r/kayaks");
    assert.match(
      submissions[1]?.message ?? "",
      /^Kayaks\n[\s\S]*https:\/\/louez\.test\/r\/kayaks$/,
    );
  });

  test("a prepaid SMS the provider accepted is never sent again when its debit fails", async () => {
    // The debit fails every time it is tried right after the send.
    recordFailures = 99;
    const outcome = await send("customer_request_accepted", context("customer_request_accepted"));
    assert.equal(outcome, undefined, "the outbox row is sent: no retry");
    assert.equal(submissions.length, 1, "one submission to the provider");
    assert.equal(records.length, 0);
    assert.equal(queued.length, 1, "the record goes to the outbox instead");
    const record = queued[0] as { id: string; messageId: string; creditSource: string };
    assert.equal(record.messageId, "provider_1", "the provider's id is kept");
    assert.equal(record.creditSource, "topup");
  });

  test("a debit that fails once is written on the next try, under the same id", async () => {
    recordFailures = 1;
    await send("customer_request_rejected", context("customer_request_rejected"));
    assert.equal(submissions.length, 1);
    assert.equal(records.length, 1);
    assert.equal(queued.length, 0);
    assert.equal(records[0]?.messageId, "provider_1");
    assert.equal(records[0]?.id.length, 21, "the record's own key");
  });
});
