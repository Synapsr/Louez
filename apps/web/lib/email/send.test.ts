import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, beforeEach, describe, test } from "node:test";

// The emails that state an amount of a reservation state it in the reservation's
// currency, frozen when it was made, whatever the store's is when they go out
// (invariant M2). The transport and the email log are fakes: nothing leaves the
// machine and no database is read.

const SENT_KEY = "__louezSendTestEmails";
const directory = mkdtempSync(join(tmpdir(), "louez-email-send-"));
const transportPath = join(directory, "email.cjs");
writeFileSync(
  transportPath,
  [
    "module.exports = {",
    "  isEmailConfigured: () => true,",
    "  sendEmail: async (options) => {",
    `    globalThis[${JSON.stringify(SENT_KEY)}].push(options.html);`,
    "    return { messageId: 'id' };",
    "  },",
    "};",
  ].join("\n"),
);
const databasePath = join(directory, "db.cjs");
writeFileSync(
  databasePath,
  "module.exports = { db: { insert: () => ({ values: async () => {} }) }, emailLogs: {} };",
);
after(() => rmSync(directory, { recursive: true }));

const sent: string[] = [];
Reflect.set(globalThis, SENT_KEY, sent);

Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    const parent = context.parentURL ?? "";
    // The logo helper imports "server-only", which throws outside Next.
    if (specifier === "server-only") return { url: "node:module", shortCircuit: true };
    if (specifier === "@louez/email" && parent.includes("email/client.ts")) {
      return { url: pathToFileURL(transportPath).href, shortCircuit: true };
    }
    if (specifier === "@louez/db" && parent.includes("email/send.ts")) {
      return { url: pathToFileURL(databasePath).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

// The store has moved to dollars since the reservation was booked.
const store = {
  id: "store_send",
  name: "Harbour Bikes",
  email: "contact@bikes.test",
  settings: { currency: "USD", country: "US", timezone: "America/New_York" },
};
const customer = { firstName: "Lea", lastName: "Martin", email: "lea@example.test" };
const to = customer.email;
const locale = "en" as const;
const startDate = new Date("2031-05-01T08:00:00Z");
const endDate = new Date("2031-05-03T08:00:00Z");
const url = "https://bikes.example.test/reservation";
const items = [{ name: "Bike", quantity: 1, unitPrice: 120, totalPrice: 120 }];

describe("emails that state an amount", () => {
  let send: typeof import("./send");

  before(async () => {
    send = await import("./send");
  });

  beforeEach(() => {
    sent.length = 0;
  });

  /** Each sender, given a reservation of 120.00 with that currency of its own. */
  const senders = (currency: string | null) => {
    const reservation = { id: "res_send", number: "R-1001", currency };
    const base = { to, store, customer, locale };
    return {
      sendNewRequestLandlordEmail: () =>
        send.sendNewRequestLandlordEmail({
          ...base,
          reservation: { ...reservation, startDate, endDate, totalAmount: 120 },
          dashboardUrl: url,
        }),
      sendReservationConfirmationEmail: () =>
        send.sendReservationConfirmationEmail({
          ...base,
          reservation: {
            ...reservation,
            startDate,
            endDate,
            subtotalAmount: 120,
            depositAmount: 0,
            totalAmount: 120,
          },
          items,
          reservationUrl: url,
        }),
      sendRequestAcceptedEmail: () =>
        send.sendRequestAcceptedEmail({
          ...base,
          reservation: { ...reservation, startDate, endDate, totalAmount: 120 },
          items,
          reservationUrl: url,
          contractUrl: url,
        }),
      sendQuoteSentEmail: () =>
        send.sendQuoteSentEmail({
          ...base,
          reservation: { ...reservation, startDate, endDate, totalAmount: 120 },
          items,
          reservationUrl: url,
        }),
      sendPaymentRequestEmail: () =>
        send.sendPaymentRequestEmail({
          ...base,
          reservation,
          amount: 120,
          description: "Rental",
          paymentUrl: url,
        }),
      sendDepositAuthorizationRequestEmail: () =>
        send.sendDepositAuthorizationRequestEmail({
          ...base,
          reservation,
          depositAmount: 120,
          authorizationUrl: url,
        }),
      sendPaymentConfirmationEmail: () =>
        send.sendPaymentConfirmationEmail({
          ...base,
          reservation,
          paymentAmount: 120,
          paymentDate: startDate,
        }),
      sendPaymentFailedEmail: () =>
        send.sendPaymentFailedEmail({ ...base, reservation, paymentAmount: 120 }),
      sendReservationCompletedEmail: () =>
        send.sendReservationCompletedEmail({
          ...base,
          reservation: { ...reservation, startDate, endDate },
          depositAmount: 120,
          depositReturned: true,
        }),
      sendReminderPickupAdminEmail: () =>
        send.sendReminderPickupAdminEmail({
          ...base,
          reservation: { ...reservation, startDate, totalAmount: 120 },
          dashboardUrl: url,
        }),
      sendReminderReturnAdminEmail: () =>
        send.sendReminderReturnAdminEmail({
          ...base,
          reservation: { ...reservation, endDate, totalAmount: 120 },
          dashboardUrl: url,
        }),
      sendInstantAccessEmail: () =>
        send.sendInstantAccessEmail({
          ...base,
          reservation: { ...reservation, startDate, endDate, totalAmount: 120 },
          items,
          accessUrl: url,
          showPaymentCta: true,
        }),
    };
  };

  const htmlOf = async (sender: () => Promise<unknown>) => {
    sent.length = 0;
    await sender();
    assert.equal(sent.length, 1);
    return sent[0] ?? "";
  };

  for (const name of Object.keys(senders("EUR")) as Array<keyof ReturnType<typeof senders>>) {
    test(`${name}: the reservation's currency, not the store's of today`, async () => {
      const frozen = await htmlOf(senders("EUR")[name]);
      assert.match(frozen, /€\s?120\.00/, "booked in euros");
      assert.doesNotMatch(frozen, /\$\s?120\.00/, "booked in euros");

      // A reservation older than its own currency states the store's.
      const legacy = await htmlOf(senders(null)[name]);
      assert.match(legacy, /\$\s?120\.00/, "no currency of its own");
      assert.doesNotMatch(legacy, /€/, "no currency of its own");
    });
  }
});
