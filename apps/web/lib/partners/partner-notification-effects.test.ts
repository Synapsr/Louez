import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, beforeEach, describe, test } from "node:test";

import type { EffectSendContext } from "@louez/api/platform/effects";

import type { PartnerNotificationDeps } from "./partner-notification-effects";

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// The sender's modules import "server-only", which throws outside Next.
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

// A partner's e-mails (Liens partenaires), with fakes: each reads what it is
// about when it goes out, checks its claim first, formats amounts and dates
// in the store's language, and sends nothing when the partner opted out or
// the instance has no e-mail.

const STORE = {
  name: "Vélo Évasion",
  slug: "velo-evasion",
  currency: "EUR",
  timezone: "Europe/Paris",
  country: "FR",
  logoUrl: null,
};
const base = {
  to: "accueil@les-pins.test",
  store: STORE,
  partnerName: "Camping Les Pins",
  token: "t".repeat(43),
};

/** Intl writes money and dates with no-break spaces: compared as plain ones. */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/[\u00a0\u202f]/g, " "));

describe("partner e-mail senders", () => {
  let sent: Array<Parameters<PartnerNotificationDeps["sendPartnerNotificationEmail"]>[0]> = [];
  let claims = 0;
  let emailConfigured = true;
  let optedOut = false;

  const context: EffectSendContext = {
    effectId: "effect_test",
    row: { storeId: "store", reservationId: null, customerId: null },
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    assertClaim: async () => {
      claims += 1;
    },
  };

  let senders: ReturnType<
    typeof import("./partner-notification-effects").createPartnerNotificationEffectSenders
  >;

  before(async () => {
    process.env.NEXT_PUBLIC_APP_URL ??= "https://app.louez.test";
    const { createPartnerNotificationEffectSenders } =
      await import("./partner-notification-effects");
    senders = createPartnerNotificationEffectSenders({
      isEmailConfigured: () => emailConfigured,
      readPartnerBookingNotice: async () =>
        optedOut
          ? { skipped: "partner_opted_out" }
          : {
              ...base,
              booking: {
                endDate: new Date("2026-11-24T17:00:00Z"),
                commission: 6,
                state: "upcoming",
              },
            },
      readPartnerPayoutNotice: async () => ({ ...base, month: "2026-10", amount: 15 }),
      readPartnerStatementNotice: async () => ({
        ...base,
        month: "2026-10",
        totals: { bookings: 2, due: 24, upcoming: 0, paid: 15, remaining: 9, visits: 3 },
      }),
      sendPartnerNotificationEmail: async (input) => {
        sent.push(input);
        return { success: true, messageId: "m" };
      },
    });
  });

  beforeEach(() => {
    sent = [];
    claims = 0;
    emailConfigured = true;
    optedOut = false;
  });

  test("a credited booking: its commission and the rental's end, in the store's language, after the claim", async () => {
    await senders["partner.bookingEmail"]({ partnerId: "p", reservationId: "r" }, context);
    assert.equal(claims, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "accueil@les-pins.test");
    assert.equal(sent[0].locale, "fr");
    assert.deepEqual(plain(sent[0].notification), {
      kind: "booking",
      amount: "6,00 €",
      endDate: "24 novembre",
    });
    assert.match(sent[0].spaceUrl, /\/partner\/t{43}$/);
  });

  test("a payment and a statement name the month in words", async () => {
    await senders["partner.payoutEmail"]({ partnerId: "p", payoutId: "x" }, context);
    await senders["partner.statementEmail"]({ partnerId: "p", month: "2026-10" }, context);
    assert.deepEqual(plain(sent.map((input) => input.notification)), [
      { kind: "payout", amount: "15,00 €", month: "octobre 2026" },
      {
        kind: "statement",
        month: "octobre 2026",
        bookings: 2,
        due: "24,00 €",
        paid: "15,00 €",
        remaining: "9,00 €",
      },
    ]);
  });

  test("nothing goes out to a partner who opted out, nor from an instance without e-mail", async () => {
    optedOut = true;
    assert.deepEqual(
      await senders["partner.bookingEmail"]({ partnerId: "p", reservationId: "r" }, context),
      { skipped: "partner_opted_out" },
    );
    emailConfigured = false;
    assert.deepEqual(
      await senders["partner.payoutEmail"]({ partnerId: "p", payoutId: "x" }, context),
      { skipped: "email_not_configured" },
    );
    assert.equal(sent.length, 0);
    assert.equal(claims, 0);
  });
});
