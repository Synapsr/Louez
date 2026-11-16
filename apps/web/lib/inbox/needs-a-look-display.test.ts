import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { createTranslator } from "next-intl";

import { formatCurrency } from "@/lib/utils";
import { formatStoreDate } from "@/lib/utils/store-date";

import type { NeedsALookItem, NeedsALookType } from "./needs-a-look";
import { NEEDS_A_LOOK_TYPES } from "./needs-a-look";
import {
  MESSAGE_NAMES,
  creditNoteReason,
  describeNeedsALookItem,
  type DisplayFormat,
} from "./needs-a-look-display";

// Each kind that needs a look reads from its kind and details alone, in the
// dashboard's words, with the dashboard's money and dates: every kind, every
// clause, and the three money items word for word in English and French.

const TIMEZONE = "Europe/Paris";
const formatFor = (intl: string): DisplayFormat => ({
  money: (amount, currency) => formatCurrency(Number(amount), currency, intl),
  day: (iso) => formatStoreDate(iso, TIMEZONE, "SHORTEST_DATE", intl),
});
const EN = formatFor("en-GB");
const FR = formatFor("fr-FR");

const catalog = (locale: string) =>
  JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));

const translatorFor = (locale: string) =>
  createTranslator({
    locale,
    messages: catalog(locale),
    namespace: "dashboard.needsALook",
    onError: (error) => {
      throw error;
    },
  });

/** The item as a shop owner reads it: title and sentences, in the locale. */
function read(item: NeedsALookItem, locale: "en" | "fr") {
  const t = translatorFor(locale) as unknown as (key: string, values?: object) => string;
  const display = describeNeedsALookItem(item, locale === "en" ? EN : FR);
  return {
    display,
    title: t(display.title.key, display.title.values),
    sentences: display.sentences.map((sentence) => t(sentence.key, sentence.values)),
  };
}

const RESERVATION = {
  id: "res_000000000000001",
  number: "R-1042",
  startDate: new Date("2026-11-20T09:00:00Z"),
  endDate: new Date("2026-11-22T18:00:00Z"),
  customerName: "Camille Martin",
};

function item(
  type: NeedsALookType,
  details: NeedsALookItem["details"],
  overrides: Partial<NeedsALookItem> = {},
): NeedsALookItem {
  return {
    id: `${type}:rec_1`,
    type,
    severity: "warning",
    occurredAt: new Date("2026-11-13T10:00:00Z"),
    summary: "The API's English sentence, never shown.",
    reservation: RESERVATION,
    details: { reservationId: RESERVATION.id, reservationNumber: RESERVATION.number, ...details },
    tools: [],
    links: { dashboard: "https://app.example/dashboard/reservations/res_000000000000001" },
    ...overrides,
  } as NeedsALookItem;
}

/** The no-break space Intl writes between a French amount and its currency. */
const NBSP = String.fromCharCode(0xa0);

const refundUnconfirmed = item("refund_unconfirmed", {
  operationId: "op_1",
  paymentId: "pay_1",
  chargeId: "ch_3Pabc",
  amount: "120.00",
  currency: "EUR",
  status: "requested",
  askedAt: "2026-11-12T10:00:00.000Z",
});
const refundUndone = (details: NeedsALookItem["details"]) =>
  item("refund_undone", {
    refundPaymentId: "pay_ref_1",
    refundId: "re_3Pabc",
    amount: "120.00",
    currency: "EUR",
    creditNoteNumber: null,
    listedAfterFailure: false,
    ...details,
  });
const creditNote = (lastError: string | null) =>
  item("credit_note_not_issued", {
    effectId: "eff_1",
    paymentId: "pay_1",
    refundId: "pay_ref_1",
    amount: "120.00",
    currency: "EUR",
    lastError,
  });

describe("the three money items, word for word", () => {
  test("an unconfirmed refund, in English and French", () => {
    const en = read(refundUnconfirmed, "en");
    assert.equal(en.title, "Refund not confirmed");
    assert.deepEqual(en.sentences, [
      "Stripe hasn't confirmed the €120.00 refund made on 12 Nov for booking #R-1042. Check it in Stripe before refunding again.",
      "Until Stripe answers, Louez holds this amount back from what the payment can still refund.",
    ]);
    const fr = read(refundUnconfirmed, "fr");
    assert.equal(fr.title, "Remboursement non confirmé");
    assert.deepEqual(fr.sentences, [
      `Stripe n'a pas confirmé le remboursement de 120,00${NBSP}€ fait le 12 nov. pour la réservation #R-1042. Vérifiez-le dans Stripe avant de rembourser à nouveau.`,
      "Tant que Stripe n'a pas répondu, Louez retient ce montant sur ce que le paiement peut encore rembourser.",
    ]);
    assert.equal(en.display.heldBack, true);
    assert.deepEqual(en.display.action, {
      label: "actions.viewPayment",
      href: "/dashboard/reservations/res_000000000000001#payment",
    });
    assert.deepEqual(en.display.facts, [{ label: "facts.stripeCharge", value: "ch_3Pabc" }]);
    assert.deepEqual(en.display.line, ["#R-1042", "Camille Martin", "€120.00"]);
  });

  test("a failed refund, plain, listed by Stripe afterwards, and with a credit note standing", () => {
    const plain = refundUndone({});
    assert.equal(read(plain, "en").title, "Refund failed");
    assert.deepEqual(read(plain, "en").sentences, [
      "The €120.00 refund on booking #R-1042 didn't go through: the customer wasn't refunded. Check it in Stripe and refund again if needed.",
    ]);
    assert.equal(read(plain, "fr").title, "Remboursement échoué");
    assert.deepEqual(read(plain, "fr").sentences, [
      `Le remboursement de 120,00${NBSP}€ sur la réservation #R-1042 n'a pas abouti : le client n'a pas été remboursé. Vérifiez-le dans Stripe et remboursez à nouveau si besoin.`,
    ]);

    const listed = refundUndone({ listedAfterFailure: true });
    assert.deepEqual(read(listed, "en").sentences, [
      "Stripe said the €120.00 refund on booking #R-1042 failed, then showed it as paid out. Check in Stripe whether the customer was refunded, and refund again if needed.",
    ]);
    assert.deepEqual(read(listed, "fr").sentences, [
      `Stripe a indiqué l'échec du remboursement de 120,00${NBSP}€ sur la réservation #R-1042, puis l'a montré comme versé. Vérifiez dans Stripe si le client a été remboursé, et remboursez à nouveau si besoin.`,
    ]);

    const noted = refundUndone({ creditNoteNumber: "AV-0031" });
    assert.equal(
      read(noted, "en").sentences[1],
      "Credit note AV-0031 still stands: correct it in your accounting.",
    );
    assert.equal(
      read(noted, "fr").sentences[1],
      "L'avoir AV-0031 reste émis : corrigez-le dans votre comptabilité.",
    );
    assert.deepEqual(read(noted, "en").display.facts, [
      { label: "facts.stripeRefund", value: "re_3Pabc" },
      { label: "facts.creditNote", value: "AV-0031" },
    ]);
    assert.equal(read(noted, "en").display.heldBack, false);
  });

  test("no fee given back ever shows, whatever the details carry", () => {
    const withFee = refundUndone({ feeOverReturned: "1.80" });
    const { sentences, display } = read(withFee, "en");
    assert.ok(sentences.every((sentence) => !sentence.includes("1.80")));
    assert.ok(display.facts.every((fact) => fact.value !== "1.80"));
  });

  test("a credit note not issued: each known reason, and a neutral sentence for any other", () => {
    const unknown = creditNote(
      "The refund's credit note was not issued: SMTP 550 on host 10.0.0.3",
    );
    assert.equal(read(unknown, "en").title, "Credit note missing");
    assert.deepEqual(read(unknown, "en").sentences, [
      "The €120.00 refund on booking #R-1042 has no credit note yet. Check your invoicing settings.",
      "It could not be issued; Louez retries every day.",
    ]);
    assert.equal(read(unknown, "fr").title, "Avoir non émis");
    assert.deepEqual(read(unknown, "fr").sentences, [
      `Le remboursement de 120,00${NBSP}€ sur la réservation #R-1042 n'a pas encore d'avoir. Vérifiez vos réglages de facturation.`,
      "Il n'a pas pu être émis ; Louez réessaie chaque jour.",
    ]);
    // The outbox's error never reaches the page.
    const shown = JSON.stringify(read(unknown, "en"));
    assert.ok(!shown.includes("SMTP") && !shown.includes("10.0.0.3"));

    assert.equal(
      read(creditNote("Abandoned: refund_mismatch: the refund is not this payment's"), "en")
        .sentences[1],
      "The refund recorded doesn't match the request, so Louez can't issue it on its own: contact Louez support.",
    );
    assert.equal(
      read(creditNote("The refund is still pending: its credit note waits for it."), "en")
        .sentences[1],
      "The refund wasn't settled yet when Louez tried; Louez retries every day.",
    );
    assert.equal(creditNoteReason(null), "unknown");
    assert.equal(creditNoteReason("Abandoned: payload_invalid: x"), "mismatch");
    assert.equal(creditNoteReason("Abandoned: row_mismatch: x"), "mismatch");
    assert.deepEqual(read(unknown, "en").display.secondary, {
      label: "actions.invoicingSettings",
      href: "/dashboard/settings/invoicing",
    });
  });
});

describe("every other kind, every clause", () => {
  test("a deposit not confirmed, and one Stripe holds that does not match", () => {
    const base = {
      paymentId: "pay_d",
      amount: "300.00",
      currency: "EUR",
      askedAt: "2026-11-12T10:00:00.000Z",
    };
    const plain = read(
      item("deposit_unconfirmed", { ...base, unmatchedPaymentIntentId: null }),
      "en",
    );
    assert.equal(plain.title, "Deposit not confirmed");
    assert.match(
      plain.sentences[0] ?? "",
      /^Stripe hasn't confirmed the €300.00 deposit hold asked on 12 Nov for booking #R-1042\./,
    );
    assert.deepEqual(plain.display.facts, []);
    const unmatched = read(
      item("deposit_unconfirmed", { ...base, unmatchedPaymentIntentId: "pi_3Pxyz" }),
      "en",
    );
    assert.match(unmatched.sentences[0] ?? "", /doesn't match the €300.00 asked on 12 Nov/);
    assert.deepEqual(unmatched.display.facts, [
      { label: "facts.stripePayment", value: "pi_3Pxyz" },
    ]);
    assert.equal(
      unmatched.display.action?.href,
      `/dashboard/reservations/${RESERVATION.id}#payment`,
    );
  });

  test("a second deposit hold whose release Stripe has not confirmed", () => {
    const { title, sentences, display } = read(
      item("deposit_release_failed", {
        paymentId: "pay_d2",
        paymentIntentId: "pi_3Prel",
        amount: "300.00",
        currency: "EUR",
        owedSince: "2026-11-12T10:00:00.000Z",
      }),
      "fr",
    );
    assert.equal(title, "Caution peut-être encore bloquée");
    assert.match(
      sentences[0] ?? "",
      /seconde empreinte de caution de 300,00.€ sur la réservation #R-1042/,
    );
    assert.deepEqual(display.facts, [{ label: "facts.stripePayment", value: "pi_3Prel" }]);
  });

  test("a dispute: to answer, or under Stripe's review", () => {
    const base = { disputeId: "dp_1", amount: "80.00", currency: "EUR", openedAt: null };
    const answer = read(item("dispute_open", { ...base, stripeStatus: "needs_response" }), "en");
    assert.equal(answer.title, "Payment disputed");
    assert.equal(
      answer.sentences[0],
      "The customer disputed a €80.00 payment on booking #R-1042. Answer the dispute in Stripe before its deadline.",
    );
    const warning = read(
      item("dispute_open", { ...base, stripeStatus: "warning_needs_response" }),
      "en",
    );
    assert.match(warning.sentences[0] ?? "", /Answer the dispute/);
    const review = read(item("dispute_open", { ...base, stripeStatus: "under_review" }), "en");
    assert.equal(
      review.sentences[0],
      "A €80.00 dispute on booking #R-1042 is open: Stripe is reviewing it.",
    );
    assert.deepEqual(review.display.facts, [{ label: "facts.stripeDispute", value: "dp_1" }]);
  });

  test("an e-invoice rejected, or never sent", () => {
    const base = { invoiceId: "inv_1", invoiceNumber: "F-2026-0042" };
    const rejected = read(
      item("einvoice_rejected", { ...base, transmissionStatus: "rejected" }),
      "en",
    );
    assert.equal(rejected.title, "E-invoice rejected");
    assert.equal(
      rejected.sentences[0],
      "Invoice F-2026-0042 for booking #R-1042 was rejected by the e-invoicing network. Check it on the booking.",
    );
    assert.deepEqual(rejected.display.line, ["#R-1042", "Camille Martin", "F-2026-0042"]);
    assert.equal(rejected.display.action?.href, `/dashboard/reservations/${RESERVATION.id}`);
    const failed = read(item("einvoice_rejected", { ...base, transmissionStatus: "failed" }), "en");
    assert.equal(failed.title, "E-invoice not sent");
    assert.match(failed.sentences[0] ?? "", /could not be sent to the e-invoicing network/);
  });

  test("a message not sent: each customer message by its name, the store's, with and without a booking, and each reason", () => {
    const base = { effectId: "eff_m", channel: "email", reason: null };
    const names: Record<string, string> = {
      customer_request_accepted: "acceptance message",
      customer_request_rejected: "decline message",
      customer_reservation_cancelled: "cancellation message",
      customer_reservation_modified: "change message",
      customer_quote_sent: "quote",
      customer_reservation_confirmed: "confirmation message",
    };
    for (const notification of MESSAGE_NAMES) {
      const { title, sentences } = read(
        item("message_not_sent", { ...base, audience: "customer", notification }),
        "en",
      );
      assert.equal(title, "Message not sent");
      assert.equal(
        sentences[0],
        `The ${names[notification]} for booking #R-1042 didn't reach the customer. Contact them yourself.`,
      );
    }
    const other = read(
      item("message_not_sent", { ...base, audience: "customer", notification: "something_new" }),
      "en",
    );
    assert.match(other.sentences[0] ?? "", /^The message for booking #R-1042/);
    assert.deepEqual(other.display.facts, [{ label: "facts.channel", value: "E-mail" }]);

    const loose = read(
      item(
        "message_not_sent",
        {
          effectId: "eff_m",
          audience: "customer",
          channel: "sms",
          notification: null,
          reason: null,
          reservationId: null,
          reservationNumber: null,
        },
        { reservation: null },
      ),
      "en",
    );
    assert.equal(loose.sentences[0], "A message didn't reach a customer. Contact them yourself.");
    assert.equal(loose.display.action, null);
    assert.deepEqual(loose.display.facts, [{ label: "facts.channel", value: "SMS" }]);

    const store = read(
      item("message_not_sent", { ...base, audience: "store", notification: "new_reservation" }),
      "en",
    );
    assert.equal(
      store.sentences[0],
      "A notification to your team about booking #R-1042 was not sent.",
    );
    assert.equal(store.display.action?.href, "/dashboard/settings/notifications");
    const storeLoose = read(
      item(
        "message_not_sent",
        {
          ...base,
          audience: "store",
          notification: null,
          reservationId: null,
          reservationNumber: null,
        },
        { reservation: null },
      ),
      "en",
    );
    assert.equal(storeLoose.sentences[0], "A notification to your team was not sent.");

    const reasons: Record<string, string> = {
      recipient_changed: "The customer's e-mail address changed after it was written.",
      email_not_configured: "No e-mail service is set up for sending.",
      invalid_payload: "It was written incorrectly and could not be sent.",
      row_mismatch: "It was written incorrectly and could not be sent.",
    };
    for (const [reason, sentence] of Object.entries(reasons)) {
      const read_ = read(
        item("message_not_sent", { ...base, audience: "customer", notification: null, reason }),
        "en",
      );
      assert.equal(read_.sentences[1], sentence, reason);
    }
  });

  test("an invitation not sent", () => {
    const { title, sentences, display } = read(
      item(
        "invitation_not_sent",
        {
          effectId: "eff_i",
          invitationId: "inv_t",
          email: "alex@example.com",
          reservationId: null,
          reservationNumber: null,
        },
        { reservation: null },
      ),
      "en",
    );
    assert.equal(title, "Invitation not sent");
    assert.equal(
      sentences[0],
      "The invitation e-mail to alex@example.com was not sent. Send it again, or share its link, from the team page.",
    );
    assert.deepEqual(display.line, ["alex@example.com"]);
    assert.deepEqual(display.action, { label: "actions.openTeam", href: "/dashboard/team" });
  });

  test("an action to check: by an assistant or not, on a booking, a product, or nothing", () => {
    const base = {
      operationId: "op_9",
      transport: "mcp",
      reservationId: null,
      reservationNumber: null,
    };
    const onBooking = read(
      item(
        "operation_unknown",
        {
          ...base,
          procedure: "dashboard.reservations.updateStatus",
          clientName: "Claude",
          targetId: "res_9",
        },
        { reservation: null },
      ),
      "en",
    );
    assert.equal(onBooking.title, "Action to check");
    assert.equal(
      onBooking.sentences[0],
      "An action by Claude on 13 Nov may not have been saved. Check the record before doing it again.",
    );
    assert.deepEqual(onBooking.display.action, {
      label: "actions.viewBooking",
      href: "/dashboard/reservations/res_9",
    });
    assert.deepEqual(onBooking.display.facts, [{ label: "facts.reference", value: "op_9" }]);
    // The procedure's name is a developer's word: never shown.
    assert.ok(!JSON.stringify(onBooking).includes("updateStatus"));

    const onProduct = read(
      item(
        "operation_unknown",
        { ...base, procedure: "dashboard.products.update", clientName: null, targetId: "prod_9" },
        { reservation: null },
      ),
      "en",
    );
    assert.equal(
      onProduct.sentences[0],
      "An action on 13 Nov may not have been saved. Check the record before doing it again.",
    );
    assert.deepEqual(onProduct.display.action, {
      label: "actions.viewProduct",
      href: "/dashboard/products/prod_9",
    });

    const elsewhere = read(
      item(
        "operation_unknown",
        { ...base, procedure: "dashboard.settings.updateTaxes", clientName: null, targetId: null },
        { reservation: null },
      ),
      "en",
    );
    assert.equal(elsewhere.display.action, null);
  });

  test("every kind renders in every locale with no missing message", () => {
    const samples: NeedsALookItem[] = [
      refundUnconfirmed,
      refundUndone({ creditNoteNumber: "AV-1", listedAfterFailure: true }),
      creditNote(null),
      item("deposit_unconfirmed", {
        amount: "1",
        currency: "EUR",
        askedAt: "2026-11-12T10:00:00.000Z",
      }),
      item("deposit_release_failed", { amount: "1", currency: "EUR" }),
      item("dispute_open", { amount: "1", currency: "EUR", stripeStatus: "needs_response" }),
      item("einvoice_rejected", { invoiceNumber: "F-1", transmissionStatus: "rejected" }),
      item("message_not_sent", {
        audience: "customer",
        notification: "customer_quote_sent",
        reason: "recipient_changed",
      }),
      item("invitation_not_sent", { email: "a@example.com" }),
      item("operation_unknown", { clientName: "Claude", procedure: "x", targetId: null }),
    ];
    assert.deepEqual(
      [...new Set(samples.map((sample) => sample.type))].sort(),
      [...NEEDS_A_LOOK_TYPES].sort(),
    );
    for (const locale of [
      "fr",
      "en",
      "de",
      "es",
      "it",
      "nl",
      "pt",
      "pl",
      "zh",
      "ja",
      "ru",
      "id",
      "ko",
    ]) {
      const t = translatorFor(locale) as unknown as (key: string, values?: object) => string;
      for (const sample of samples) {
        const display = describeNeedsALookItem(sample, EN);
        const keys = [
          display.title,
          ...display.sentences,
          ...display.facts.map((fact) => ({ key: fact.label })),
          ...(display.action ? [{ key: display.action.label }] : []),
          ...(display.secondary ? [{ key: display.secondary.label }] : []),
        ];
        for (const message of keys) {
          assert.ok(
            t(message.key, (message as { values?: object }).values),
            `${locale} ${message.key}`,
          );
        }
      }
    }
  });
});
