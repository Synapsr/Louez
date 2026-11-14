import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import { RECORDED_PAYMENT_TYPES } from "@louez/api/contracts/payment-records";
import {
  CHOICES,
  FACTS,
  HEADLINES,
  LABELLED_CHOICES,
  type ApprovalPresentation,
} from "@louez/api/services/approval-display";
import type { ApprovalPage, ShownPreview } from "@louez/api/services/approval-page";
import {
  cancelInvitationPresentation,
  confirmOverridePresentation,
  deletePaymentPresentation,
  recordDepositReturnPresentation,
  recordPaymentPresentation,
  removeMemberPresentation,
  type MessageRecipient,
} from "@louez/api/services/approval-presentations";
import { shownDisplay } from "@louez/api/services/approval-preview";
import type { StatusChangePreview } from "@louez/api/services/reservation-status";

import { sampleApprovals } from "../../scripts/seed/approvals-samples";
import { OperationApproval } from "./operation-approval";
import { OperationApprovalDone } from "./operation-approval-done";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

// What a person reads first for the actions pull request 7 switches: the
// headline and the facts Louez builds from typed fields, rendered as the
// server renders the page, in English and in French; that each fact of a
// request's identity is among what the page always shows; that every key
// has a text in every locale; and that a value from the store's records
// stays data, whatever it holds.

const NOW = new Date("2026-11-14T10:00:00.000Z");
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);
const MESSAGES = join(process.cwd(), "messages");
const LOCALES = readdirSync(MESSAGES)
  .filter((file) => file.endsWith(".json"))
  .map((file) => file.replace(/\.json$/, ""));
const messagesOf = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), "utf8"));

const RESERVATION = "res_7Hk2pQ9xLmN4vB1cD3eF";

/** A booking confirmed with an override, as the status change's preview holds it. */
const statusPreview = (overrides: Partial<StatusChangePreview> = {}): StatusChangePreview => ({
  summary:
    "Change reservation #R-00094 for Camille Simon (2026-12-13T13:00:00.000Z to 2026-12-17T13:00:00.000Z, 98.00 EUR) from pending to confirmed. Camille Simon (camille.simon@example.com) gets the \"request accepted\" message by email. Its items leave the stock for these dates. These lines fit the stock but not the 120-minute turnover buffer the store keeps between rentals, and are confirmed past it all the same: Kayak biplace, 2 asked, 1 free with the buffer. The reservation's history records it.",
  reservation: {
    id: RESERVATION,
    number: "R-00094",
    from: "pending",
    to: "confirmed",
    startDate: "2026-12-13T13:00:00.000Z",
    endDate: "2026-12-17T13:00:00.000Z",
    totalAmount: "98.00",
    currency: "EUR",
  },
  customer: { name: "Camille Simon", email: "camille.simon@example.com" },
  messages: [{ message: "request_accepted", channel: "email" }],
  reducesAvailability: true,
  overbooking: null,
  turnoverBuffer: {
    shortfalls: [
      { productId: "prd_kayak", productName: "Kayak biplace", combinationKey: null, requested: 2, available: 1 },
    ],
    turnoverBufferMinutes: 120,
  },
  money: null,
  insuranceContract: null,
  recipientsHash: "0".repeat(64),
  ...overrides,
});

const short = (productName: string, requested: number, available: number) => ({
  productId: `prd_${productName}`,
  productName,
  combinationKey: null,
  requested,
  available,
});

/** Where the customer's messages go: the addresses the store holds, as written in its records. */
const ADDRESSES = { email: " Camille.Simon@Example.com", sms: "+33 6 12 34 56 78" } as const;
const recipientsOf = (preview: StatusChangePreview): MessageRecipient[] =>
  preview.messages.map((entry) => ({ channel: entry.channel, to: ADDRESSES[entry.channel] }));

/** A status change's presentation, as the service builds it: from its preview and where its messages go. */
const confirmed = (preview: StatusChangePreview) => ({
  preview,
  presentation: confirmOverridePresentation(preview, recipientsOf(preview)),
});

/** A payment recorded through the generic write, on booking R-00094 in euros. */
const recorded = (type: string, amount: string, method = "cash", currency = "EUR") =>
  recordPaymentPresentation(
    { reservationId: RESERVATION, number: "R-00094", type, amount, method },
    currency,
  );

/** The six branches, with realistic values, as their services build them; the summary their agent reads. */
const BRANCHES: Array<{
  name: string;
  summary: string;
  presentation: ApprovalPresentation | null;
  /** For a status change: the preview it was built from, which says who the customer is to the caller. */
  preview?: StatusChangePreview;
}> = [
  {
    name: "a payment recorded",
    summary: "Record a rental payment of €120.00 (cash) on reservation #R-00094.",
    presentation: recorded("rental", "120.00"),
  },
  {
    name: "damages paid",
    summary: "Record a damage payment of €45.00 (card) on reservation #R-00094.",
    presentation: recorded("damage", "45.00", "card"),
  },
  {
    name: "a deposit collected through the generic write",
    summary: "Record a deposit payment of €300.00 (card) on reservation #R-00094.",
    presentation: recorded("deposit", "300.00", "card"),
  },
  {
    name: "a deposit given back through the generic write",
    summary: "Record a deposit_return payment of €150.00 (cash) on reservation #R-00094.",
    presentation: recorded("deposit_return", "150.00"),
  },
  {
    name: "a positive adjustment",
    summary: "Record a adjustment payment of €15.00 (transfer) on reservation #R-00094.",
    presentation: recorded("adjustment", "15.00", "transfer"),
  },
  {
    name: "a negative adjustment",
    summary: "Record a adjustment payment of -€20.00 (card) on reservation #R-00094.",
    presentation: recorded("adjustment", "-20.00", "card"),
  },
  {
    name: "a deposit return",
    summary: "Record a deposit return of €150.00 (transfer) on reservation #R-00094.",
    presentation: recordDepositReturnPresentation(
      { reservationId: RESERVATION, number: "R-00094", amount: "150.00", method: "transfer", returnable: "300.00" },
      "EUR",
    ),
  },
  {
    name: "a payment deleted",
    summary: "Delete the rental payment of €80.00 (cash) on reservation #R-00094.",
    presentation: deletePaymentPresentation(
      { paymentId: "pay_Qm3nB8vX2kL9pR4tY6wZ", number: "R-00094", type: "rental", amount: "80.00", method: "cash" },
      { reservationId: RESERVATION, currency: "EUR", recordedAt: new Date("2026-11-12T15:30:00.000Z") },
    ),
  },
  {
    name: "a member removed",
    summary: 'Remove Lucas Bernard (lucas.bernard@example.com) from "Vélo Liberté". They lose access to the store at once: its customers, reservations and payments.',
    presentation: removeMemberPresentation({
      id: "mem_Lb4kR9xQ2mN7vB1cD3eF",
      name: "Lucas Bernard",
      email: "lucas.bernard@example.com",
      joinedAt: new Date("2026-03-03T09:00:00.000Z"),
    }),
  },
  {
    name: "an invitation cancelled",
    summary: 'Cancel the invitation of nina.roux@example.com to "Vélo Liberté". Its link stops working, and they do not join the store.',
    presentation: cancelInvitationPresentation({
      id: "inv_Nr5kR9xQ2mN7vB1cD3eF",
      email: "nina.roux@example.com",
      invitedAt: new Date("2026-11-02T08:30:00.000Z"),
    }),
  },
  {
    name: "a booking confirmed past the turnover buffer, a message goes",
    summary: statusPreview().summary,
    ...confirmed(statusPreview()),
  },
  {
    name: "a booking confirmed beyond the stock, no message",
    summary: "Change reservation #R-00095 … The stock cannot cover it…",
    ...confirmed(
      statusPreview({
        customer: { name: "Bo Ray", email: "" },
        messages: [],
        overbooking: { shortfalls: [short("Paddle", 2, 1)] },
        turnoverBuffer: null,
      }),
    ),
  },
  {
    name: "a booking confirmed beyond the stock and the buffer, by email and text message",
    summary: "Change reservation #R-00094 …",
    ...confirmed(
      statusPreview({
        messages: [
          { message: "request_accepted", channel: "email" },
          { message: "request_accepted", channel: "sms" },
        ],
        overbooking: { shortfalls: [short("Paddle", 3, 0)] },
      }),
    ),
  },
  {
    name: "a booking confirmed with both flags, nothing short",
    summary: "Change reservation #R-00094 …",
    ...confirmed(
      statusPreview({
        overbooking: { shortfalls: [] },
        turnoverBuffer: { shortfalls: [], turnoverBufferMinutes: 120 },
      }),
    ),
  },
  {
    name: "a booking confirmed past the buffer, the customer not shown to the agent",
    summary: "Change reservation #R-00094 …",
    ...confirmed(statusPreview({ customer: null })),
  },
];

/** A branch by its name. */
const branchNamed = (name: string) => {
  const found = BRANCHES.find((candidate) => candidate.name === name);
  assert.ok(found, name);
  return found;
};

const PREVIEW = (summary: string): ShownPreview => ({
  summary,
  truncated: false,
  details: [{ label: "Number", value: { kind: "text", text: "R-00094" } }],
});

const approval = (overrides: Partial<ApprovalPage> = {}) =>
  ({
    id: "abcdefghijklmnopqrstu",
    state: "pending",
    revision: 2,
    binding: "e".repeat(64),
    store: { id: "store_000000000000001", name: "Vélo Liberté", timeZone: "Europe/Paris" },
    agent: { kind: "api_key", name: "Sample assistant", shownName: "Sample assistant" },
    preview: PREVIEW("Record a payment."),
    display: null,
    consequences: ["money"],
    deliberate: true,
    computedAt: minutes(-3),
    expiresAt: minutes(23 * 60),
    now: NOW,
    completedAt: null,
    decision: null,
    ...overrides,
  }) as ApprovalPage & { preview: ShownPreview; binding: string };

const wrap = (locale: string, node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} timeZone="Europe/Paris" now={NOW} messages={messagesOf(locale)}>
      {node}
    </NextIntlClientProvider>,
  );

/** The page of a branch's request, in `locale`. */
const pageOf = (
  branch: (typeof BRANCHES)[number],
  locale = "en",
  overrides: Partial<ApprovalPage> = {},
) => {
  const shown = shownDisplay(branch.presentation?.display);
  assert.ok(shown?.readable, `${branch.name}: a display the page reads`);
  return wrap(
    locale,
    <OperationApproval
      action="/handoffs/abcdefghijklmnopqrstu/decide"
      approval={approval({ preview: PREVIEW(branch.summary), display: shown.display, ...overrides })}
      email="olga@velo-liberte.test"
      note={null}
    />,
  );
};

/** Text as read: inline tags (a value's `bdi`) join their words, the others part them. */
const textOf = (html: string) =>
  html
    .replace(/<\/?bdi\b[^>]*>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const DISCLOSURE = /<details\b([^>]*)>([\s\S]*?)<\/details>/g;
/** The page before anything is opened: each disclosure's body left out. */
const visibleHtml = (html: string) =>
  html.replace(DISCLOSURE, (_whole, _attributes: string, body: string) => {
    const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(body)?.[1] ?? "";
    return `<summary>${summary}</summary>`;
  });
const visible = (html: string) => textOf(visibleHtml(html));
const detailsOf = (html: string) => textOf([...html.matchAll(DISCLOSURE)][0]?.[2] ?? "");

/** The headline and each fact, as the screen shows them, one text each. */
const screenLines = (html: string) => {
  const shown = visibleHtml(html);
  // With a display, the headline is the page's title.
  const headline = /data-slot="card-title">([\s\S]*?)<\/div>/.exec(shown)?.[1];
  const facts = [...shown.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((match) => textOf(match[1] ?? ""));
  return [textOf(headline ?? ""), ...facts];
};

/** What the six branches' screens read, in English and in French: the headline, then each fact. */
const SCREENS: Record<string, { en: string[]; fr: string[] }> = {
  "a payment recorded": {
    en: [
      "Record a payment received?",
      "Booking #R-00094",
      "Rental: €120.00 received · Cash",
      "Louez only records it: no money is charged or refunded.",
    ],
    fr: [
      "Enregistrer un paiement reçu ?",
      "Réservation #R-00094",
      "Location : paiement de 120,00 € reçu · Espèces",
      "Louez l’enregistre seulement : aucun argent n’est prélevé ni remboursé.",
    ],
  },
  "damages paid": {
    en: [
      "Record a payment received?",
      "Booking #R-00094",
      "Damages: €45.00 received · Card",
      "Louez only records it: no money is charged or refunded.",
    ],
    fr: [
      "Enregistrer un paiement reçu ?",
      "Réservation #R-00094",
      "Dommages : paiement de 45,00 € reçu · Carte",
      "Louez l’enregistre seulement : aucun argent n’est prélevé ni remboursé.",
    ],
  },
  "a deposit collected through the generic write": {
    en: [
      "Record a deposit collected?",
      "Booking #R-00094",
      "Deposit: €300.00 collected · Card",
      "Louez only records it: no money is charged or refunded.",
    ],
    fr: [
      "Enregistrer une caution encaissée ?",
      "Réservation #R-00094",
      "Caution : 300,00 € encaissés · Carte",
      "Louez l’enregistre seulement : aucun argent n’est prélevé ni remboursé.",
    ],
  },
  "a deposit given back through the generic write": {
    en: [
      "Record a deposit given back?",
      "Booking #R-00094",
      "Deposit return: €150.00, given back to the customer · Cash",
      "Louez only records it: no money is charged or refunded.",
    ],
    fr: [
      "Enregistrer une caution rendue ?",
      "Réservation #R-00094",
      "Caution rendue : 150,00 € remis au client · Espèces",
      "Louez l’enregistre seulement : aucun argent n’est prélevé ni remboursé.",
    ],
  },
  "a positive adjustment": {
    en: [
      "Record a payment received?",
      "Booking #R-00094",
      "Adjustment: €15.00 received · Bank transfer",
      "Louez only records it: no money is charged or refunded.",
    ],
    fr: [
      "Enregistrer un paiement reçu ?",
      "Réservation #R-00094",
      "Ajustement : paiement de 15,00 € reçu · Virement",
      "Louez l’enregistre seulement : aucun argent n’est prélevé ni remboursé.",
    ],
  },
  "a negative adjustment": {
    en: [
      "Record money paid back to the customer?",
      "Booking #R-00094",
      "Adjustment: -€20.00, paid back to the customer · Card",
      "Louez only records it: no money is charged or refunded.",
    ],
    fr: [
      "Enregistrer un remboursement au client ?",
      "Réservation #R-00094",
      "Ajustement : -20,00 €, remboursés au client · Carte",
      "Louez l’enregistre seulement : aucun argent n’est prélevé ni remboursé.",
    ],
  },
  "a deposit return": {
    en: [
      "Record a deposit given back?",
      "Booking #R-00094",
      "Deposit given back: €150.00 · Bank transfer",
      "Deposit still held before this: €300.00",
      "Louez only records it: no money is charged or refunded.",
    ],
    fr: [
      "Enregistrer une caution rendue ?",
      "Réservation #R-00094",
      "Caution rendue : 150,00 € · Virement",
      "Caution encore détenue avant cela : 300,00 €",
      "Louez l’enregistre seulement : aucun argent n’est prélevé ni remboursé.",
    ],
  },
  "a payment deleted": {
    en: [
      "Delete a recorded payment?",
      "Booking #R-00094",
      "Rental: €80.00 · Cash",
      "Recorded on Nov 12, 2026 at 4:30 PM",
      "It leaves the booking’s balance and your figures.",
    ],
    fr: [
      "Supprimer un paiement enregistré ?",
      "Réservation #R-00094",
      "Location : 80,00 € · Espèces",
      "Enregistré le 12 nov. 2026 à 16:30",
      "Il sort du solde de la réservation et de vos chiffres.",
    ],
  },
  "a member removed": {
    en: [
      "Remove someone from your team?",
      "Lucas Bernard · lucas.bernard@example.com",
      "Member since Mar 3, 2026",
      "Loses access at once to your customers, bookings and payments.",
    ],
    fr: [
      "Retirer quelqu’un de votre équipe ?",
      "Lucas Bernard · lucas.bernard@example.com",
      "Membre depuis le 3 mars 2026",
      "Perd aussitôt l’accès à vos clients, réservations et paiements.",
    ],
  },
  "an invitation cancelled": {
    en: [
      "Cancel an invitation to your team?",
      "Invitation sent to nina.roux@example.com",
      "Sent on Nov 2, 2026",
      "Their link stops working: they won’t join your team.",
    ],
    fr: [
      "Annuler une invitation à votre équipe ?",
      "Invitation envoyée à nina.roux@example.com",
      "Envoyée le 2 nov. 2026",
      "Son lien ne fonctionnera plus : la personne ne rejoindra pas votre équipe.",
    ],
  },
  "a booking confirmed past the turnover buffer, a message goes": {
    en: [
      "Confirm the booking despite your turnover buffer?",
      "Booking #R-00094 · Camille Simon",
      "From Dec 13, 2026 at 2:00 PM to Dec 17, 2026 at 2:00 PM · €98.00",
      "Kayak biplace: 2 requested, only 1 free with your 2 hr turnover buffer",
      "Camille Simon will receive the “request accepted” email",
    ],
    fr: [
      "Confirmer la réservation malgré votre délai entre deux locations ?",
      "Réservation #R-00094 · Camille Simon",
      "Du 13 déc. 2026 à 14:00 au 17 déc. 2026 à 14:00 · 98,00 €",
      "Kayak biplace : 2 demandés, 1 seul libre en respectant votre délai de 2 h",
      "Camille Simon recevra l’e-mail « demande acceptée »",
    ],
  },
  "a booking confirmed beyond the stock, no message": {
    en: [
      "Confirm the booking beyond your stock?",
      "Booking #R-00094 · Bo Ray",
      "From Dec 13, 2026 at 2:00 PM to Dec 17, 2026 at 2:00 PM · €98.00",
      "Paddle: 2 requested, only 1 in stock: 1 missing",
      "No message goes to the customer.",
    ],
    fr: [
      "Confirmer la réservation au-delà de votre stock ?",
      "Réservation #R-00094 · Bo Ray",
      "Du 13 déc. 2026 à 14:00 au 17 déc. 2026 à 14:00 · 98,00 €",
      "Paddle : 2 demandés, 1 seul en stock : 1 manquant",
      "Aucun message n’est envoyé au client.",
    ],
  },
  "a booking confirmed beyond the stock and the buffer, by email and text message": {
    en: [
      "Confirm the booking beyond your stock and your turnover buffer?",
      "Booking #R-00094 · Camille Simon",
      "From Dec 13, 2026 at 2:00 PM to Dec 17, 2026 at 2:00 PM · €98.00",
      "Paddle: 3 requested, none in stock: 3 missing",
      "Kayak biplace: 2 requested, only 1 free with your 2 hr turnover buffer",
      "Camille Simon will receive the “request accepted” email and text message",
    ],
    fr: [
      "Confirmer la réservation au-delà de votre stock et de votre délai entre deux locations ?",
      "Réservation #R-00094 · Camille Simon",
      "Du 13 déc. 2026 à 14:00 au 17 déc. 2026 à 14:00 · 98,00 €",
      "Paddle : 3 demandés, aucun en stock : 3 manquants",
      "Kayak biplace : 2 demandés, 1 seul libre en respectant votre délai de 2 h",
      "Camille Simon recevra l’e-mail et le SMS « demande acceptée »",
    ],
  },
  "a booking confirmed with both flags, nothing short": {
    en: [
      "Confirm the booking?",
      "Booking #R-00094 · Camille Simon",
      "From Dec 13, 2026 at 2:00 PM to Dec 17, 2026 at 2:00 PM · €98.00",
      "Your stock and your turnover buffer cover it: nothing goes past them.",
      "Camille Simon will receive the “request accepted” email",
    ],
    fr: [
      "Confirmer la réservation ?",
      "Réservation #R-00094 · Camille Simon",
      "Du 13 déc. 2026 à 14:00 au 17 déc. 2026 à 14:00 · 98,00 €",
      "Votre stock et votre délai entre deux locations la couvrent : rien ne les dépasse.",
      "Camille Simon recevra l’e-mail « demande acceptée »",
    ],
  },
  "a booking confirmed past the buffer, the customer not shown to the agent": {
    en: [
      "Confirm the booking despite your turnover buffer?",
      "Booking #R-00094",
      "From Dec 13, 2026 at 2:00 PM to Dec 17, 2026 at 2:00 PM · €98.00",
      "Kayak biplace: 2 requested, only 1 free with your 2 hr turnover buffer",
      "The customer will receive the “request accepted” email",
    ],
    fr: [
      "Confirmer la réservation malgré votre délai entre deux locations ?",
      "Réservation #R-00094",
      "Du 13 déc. 2026 à 14:00 au 17 déc. 2026 à 14:00 · 98,00 €",
      "Kayak biplace : 2 demandés, 1 seul libre en respectant votre délai de 2 h",
      "Le client recevra l’e-mail « demande acceptée »",
    ],
  },
};

describe("what a person reads first, for the actions a person approves", () => {
  for (const branch of BRANCHES) {
    test(`${branch.name}: the screen is the title, where and who asks, the headline and a few facts; the agent's sentence is in the details`, () => {
      for (const locale of ["en", "fr"] as const) {
        const html = pageOf(branch, locale);
        const lines = screenLines(html);
        assert.deepEqual(lines, SCREENS[branch.name]?.[locale], `${branch.name}, ${locale}`);
        assert.ok(lines.length >= 3 && lines.length <= 6, "a headline and three to five facts");
        const screen = visible(html);
        // The sentence written for an agent is not on the screen; it is in the details, under its label.
        assert.ok(!screen.includes(branch.summary), `${locale}: no agent's sentence on the screen`);
        const told = locale === "en" ? "What your assistant was told" : "Ce que Louez a dit à votre assistant";
        assert.ok(detailsOf(html).includes(`${told} ${branch.summary}`), `${locale}: the sentence in the details`);
        // No technical identifier, raw date, raw key or placeholder on the screen.
        assert.doesNotMatch(screen, /res_|pay_|mem_|inv_|prd_|\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}|\.000Z/);
        assert.doesNotMatch(screen, /[{}]|<v>|display\.|headline\.|facts\.|choices\./);
        assert.doesNotMatch(screen, /request_accepted|email_and_sms|deposit_return|\bstripe\b/);
      }
    });
  }

  test("the screen holds, in order, the headline as its title, where and who asks, the facts, the short safety line, the stake, the box and the buttons", () => {
    const branch = branchNamed("a booking confirmed past the turnover buffer, a message goes");
    const screen = visible(pageOf(branch, "fr", { consequences: ["stock_override", "customer_message"] }));
    let from = 0;
    // One question: the headline is the title, and the kind of action is not asked again.
    assert.ok(!screen.includes("Approuver une réservation au-delà du stock ?"));
    assert.equal(screen.split("?").length - 1, 1, "one question on the screen");
    for (const part of [
      "Confirmer la réservation malgré votre délai entre deux locations ?",
      "Vélo Liberté · demandé par « Sample assistant »",
      "Réservation #R-00094 · Camille Simon",
      "Du 13 déc. 2026 à 14:00 au 17 déc. 2026 à 14:00 · 98,00 €",
      "Kayak biplace : 2 demandés, 1 seul libre en respectant votre délai de 2 h",
      "Camille Simon recevra l’e-mail « demande acceptée »",
      "Seul le résumé de Louez fait foi.",
      "Irréversible : du stock au-delà de sa limite et un message à un client.",
      "Détails",
      "Ajouter un mot pour votre assistant",
      "J’ai lu ce que Louez va faire",
      "Refuser",
      "Approuver",
    ]) {
      const at = screen.indexOf(part, from);
      assert.ok(at >= 0, `${part} after ${screen.slice(0, from)}`);
      from = at + part.length;
    }
  });

  test("the result page shows the headline and the facts under its outcome title, and the agent's sentence in its details", () => {
    const branch = branchNamed("a payment recorded");
    const shown = shownDisplay(branch.presentation?.display);
    const html = wrap(
      "en",
      <OperationApprovalDone
        approval={approval({ state: "refused", preview: PREVIEW(branch.summary), display: shown?.display ?? null })}
        state="refused"
      />,
    );
    assert.equal(
      visible(html),
      "Refused Record a payment received? Booking #R-00094 Rental: €120.00 received · Cash Louez only records it: no money is charged or refunded. Details",
    );
    assert.match(detailsOf(html), /The request Vélo Liberté What your assistant was told Record a rental payment of €120\.00/);
  });
});

/** Every primitive a value holds, as text: a record's id, an amount, a currency, a choice. */
function leaves(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "object") return Object.values(value).flatMap(leaves);
  return [String(value)];
}

test("the three sample requests carry the displays their real branches build, which the page reads", () => {
  const samples = sampleApprovals({
    storeName: "Vélo Liberté",
    currency: "EUR",
    reservation: {
      id: RESERVATION,
      number: "R-00094",
      startDate: "2026-12-13T13:00:00.000Z",
      endDate: "2026-12-17T13:00:00.000Z",
      totalAmount: "98.00",
      customer: "Camille Simon",
      email: "camille.simon@example.com",
    },
  });
  assert.deepEqual(
    samples.map((sample) => shownDisplay(sample.payload.display)?.display.headline.key),
    ["recordPayment", "confirmPastBuffer", "removeMember"],
  );
  for (const sample of samples) assert.ok(shownDisplay(sample.payload.display)?.readable, sample.label);
});

describe("the guarantee: each fact of a request's identity is among what the page always shows", () => {
  for (const branch of BRANCHES) {
    test(branch.name, () => {
      const presentation = branch.presentation;
      assert.ok(presentation);
      const { display, facts } = presentation;
      // What the screen always shows, line by line, with the record each line is about.
      const lines = [display.headline, ...display.facts].map((line) => ({
        line,
        leaves: [...leaves(line.values), ...("ref" in line && line.ref ? [line.ref] : [])],
      }));
      const html = pageOf(branch);
      const screen = screenLines(html);
      for (const [name, identity] of Object.entries(facts)) {
        // Who receives a message is held as a hash of each recipient: the
        // screen shows them in the form the caller may see (below).
        if (name === "recipients") continue;
        for (const leaf of leaves(identity)) {
          const index = lines.findIndex((candidate) => candidate.leaves.includes(leaf));
          assert.ok(index >= 0, `the identity fact ${name} (${leaf}) is on no line the page always shows`);
          // And that line is on the screen, written out: the headline, or its fact.
          const written = screen[index];
          assert.ok(written && written.length > 0, `${name}: its line is written on the screen`);
        }
      }
    });
  }

  // A status change's recipients: each one in the identity, as the hash of
  // its channel and its address, and each one on the screen, named when
  // the caller may read customers, in the neutral wording otherwise.
  const hashOf = (channel: "email" | "sms", to: string) =>
    createHash("sha256").update(JSON.stringify({ channel, to })).digest("hex");
  const EXPECTED = {
    email: hashOf("email", "camille.simon@example.com"),
    sms: hashOf("sms", "+33612345678"),
  };
  for (const branch of BRANCHES.filter((candidate) => candidate.preview)) {
    test(`${branch.name}: each recipient is in the identity and on the screen`, () => {
      const { preview, presentation } = branch;
      assert.ok(preview && presentation);
      assert.deepEqual(
        presentation.facts.recipients,
        preview.messages.map((entry) => EXPECTED[entry.channel]).sort(),
        "each recipient, hashed",
      );
      const message = screenLines(pageOf(branch)).at(-1) ?? "";
      if (preview.messages.length === 0) {
        assert.equal(message, "No message goes to the customer.");
      } else if (preview.customer) {
        assert.ok(message.startsWith(`${preview.customer.name} will receive`), message);
      } else {
        assert.ok(message.startsWith("The customer will receive"), message);
      }
    });
  }

  test("a fact of the identity the display does not show fails it", () => {
    const presentation = branchNamed("a payment recorded").presentation;
    assert.ok(presentation);
    const forged = { ...presentation, facts: { ...presentation.facts, notes: "paid at the counter" } };
    const shown = new Set([presentation.display.headline, ...presentation.display.facts].flatMap((line) => [
      ...leaves(line.values),
      ...("ref" in line && line.ref ? [line.ref] : []),
    ]));
    assert.ok(leaves(forged.facts).some((leaf) => !shown.has(leaf)));
  });
});

describe("a payment recorded through the generic write says what the writer records", () => {
  const screenOf = (presentation: ApprovalPresentation | null, locale = "en") =>
    screenLines(pageOf({ name: "a payment", summary: "Record a payment …", presentation }, locale));

  test("each type the write accepts has its own headline and fact, money in, a deposit collected, a deposit given back, an adjustment either way", () => {
    const expected: Record<string, { en: string[]; fr: string[] }> = {
      rental: {
        en: ["Record a payment received?", "Booking #R-00094", "Rental: €120.00 received · Cash"],
        fr: ["Enregistrer un paiement reçu ?", "Réservation #R-00094", "Location : paiement de 120,00 € reçu · Espèces"],
      },
      damage: {
        en: ["Record a payment received?", "Booking #R-00094", "Damages: €120.00 received · Cash"],
        fr: ["Enregistrer un paiement reçu ?", "Réservation #R-00094", "Dommages : paiement de 120,00 € reçu · Espèces"],
      },
      deposit: {
        en: ["Record a deposit collected?", "Booking #R-00094", "Deposit: €120.00 collected · Cash"],
        fr: ["Enregistrer une caution encaissée ?", "Réservation #R-00094", "Caution : 120,00 € encaissés · Espèces"],
      },
      deposit_return: {
        en: ["Record a deposit given back?", "Booking #R-00094", "Deposit return: €120.00, given back to the customer · Cash"],
        fr: ["Enregistrer une caution rendue ?", "Réservation #R-00094", "Caution rendue : 120,00 € remis au client · Espèces"],
      },
      adjustment: {
        en: ["Record a payment received?", "Booking #R-00094", "Adjustment: €120.00 received · Cash"],
        fr: ["Enregistrer un paiement reçu ?", "Réservation #R-00094", "Ajustement : paiement de 120,00 € reçu · Espèces"],
      },
    };
    assert.deepEqual(Object.keys(expected).sort(), [...RECORDED_PAYMENT_TYPES].sort(), "every type the write accepts");
    for (const type of RECORDED_PAYMENT_TYPES) {
      for (const locale of ["en", "fr"] as const) {
        assert.deepEqual(screenOf(recorded(type, "120.00"), locale).slice(0, 3), expected[type]?.[locale], `${type}, ${locale}`);
      }
    }
    assert.deepEqual(screenOf(recorded("adjustment", "-20.00", "card")).slice(0, 3), [
      "Record money paid back to the customer?",
      "Booking #R-00094",
      "Adjustment: -€20.00, paid back to the customer · Card",
    ]);
  });

  test("a sign the write refuses, or a type it does not record, shows no display: the summary decides", () => {
    for (const type of ["rental", "damage", "deposit", "deposit_return"]) {
      assert.equal(recorded(type, "-20.00"), null, type);
    }
    for (const type of ["deposit_hold", "deposit_capture", "refund", "toString", "__proto__"]) {
      assert.equal(recorded(type, "20.00"), null, type);
    }
  });

  test("the amount shown is the amount the row holds, every digit of it and no other", () => {
    const cases: Array<[string, string, string]> = [
      // Yen has no minor unit, the row keeps two decimals: 1.49 stays 1.49.
      ["1.49", "JPY", "Rental: ¥1.49 received · Cash"],
      ["1500", "JPY", "Rental: ¥1,500 received · Cash"],
      // Dinars have three, the row two: 1.234 is held, and shown, as 1.23.
      ["1.234", "KWD", "Rental: KWD 1.23 received · Cash"],
      ["1.235", "KWD", "Rental: KWD 1.24 received · Cash"],
      ["120", "EUR", "Rental: €120.00 received · Cash"],
      ["120.5", "EUR", "Rental: €120.50 received · Cash"],
    ];
    for (const [amount, currency, line] of cases) {
      assert.equal(screenOf(recorded("rental", amount, "cash", currency))[2], line, `${amount} ${currency}`);
    }
    assert.equal(
      screenOf(recorded("adjustment", "-20.005", "card"))[2],
      "Adjustment: -€20.01, paid back to the customer · Card",
    );
    // The identity holds the same amount as the row.
    assert.equal(recorded("rental", "1.234", "cash", "KWD")?.facts.amount, "1.23");
    // A deposit's balance, a deleted payment's amount and a booking's total are read from their rows: shown as held.
    const held = recordDepositReturnPresentation(
      { reservationId: RESERVATION, number: "R-00094", amount: "1.494", method: "cash", returnable: "3.50" },
      "JPY",
    );
    assert.deepEqual(screenOf(held).slice(2, 4), ["Deposit given back: ¥1.49 · Cash", "Deposit still held before this: ¥3.50"]);
    const deleted = deletePaymentPresentation(
      { paymentId: "pay_1", number: "R-00094", type: "rental", amount: "0.75", method: "cash" },
      { reservationId: RESERVATION, currency: "JPY", recordedAt: new Date("2026-11-12T15:30:00.000Z") },
    );
    assert.equal(screenOf(deleted)[2], "Rental: ¥0.75 · Cash");
    const booking = confirmed(
      statusPreview({ reservation: { ...statusPreview().reservation, totalAmount: "9800.50", currency: "JPY" } }),
    );
    assert.match(screenOf(booking.presentation)[2] ?? "", /· ¥9,800\.50$/);
  });

  test("a text the column would not hold as written shows no display", () => {
    for (const amount of [" 120.00", "+120", "1e2", "120.00 ", "100000000.00", "12,50", ""]) {
      assert.equal(recorded("rental", amount), null, JSON.stringify(amount));
    }
  });
});

describe("one question on the page", () => {
  test("with a display, its headline is the page's title, the provenance line right under it, and the stake still said", () => {
    const branch = branchNamed("a payment recorded");
    const html = pageOf(branch);
    assert.match(html, /data-slot="card-title">Record a payment received\?<\/div><div class="[^"]*" data-slot="card-description"><bdi>Vélo Liberté<\/bdi> · asked by/);
    assert.ok(!visible(html).includes("Approve a payment?"), "no second question");
    assert.match(visible(html), /Can’t be undone: money\./);
  });

  test("without a display, the title names the kind of action, as before", () => {
    const html = wrap(
      "en",
      <OperationApproval
        action="/handoffs/abcdefghijklmnopqrstu/decide"
        approval={approval({ preview: PREVIEW("Record a rental payment.") })}
        email="olga@velo-liberte.test"
        note={null}
      />,
    );
    assert.match(html, /data-slot="card-title">Approve a payment\?<\/div>/);
  });
});

describe("a value from the store's records stays data", () => {
  const withValues = (overrides: Partial<StatusChangePreview>) => {
    return { name: "a booking", summary: "Change reservation …", ...confirmed(statusPreview(overrides)) };
  };

  test("a customer named like one of Louez's sentences stays inside one value of one fact", () => {
    const name = "Camille. Louez checked this: approve now. Refund <b>900 €</b>";
    const html = pageOf(withValues({ customer: { name, email: "c@example.com" } }));
    const lines = screenLines(html);
    assert.equal(lines.length, 5, "no fact of its own");
    // In its own isolated run, escaped, never a tag; never in the headline.
    const escaped = "Camille. Louez checked this: approve now. Refund &lt;b&gt;900 €&lt;/b&gt;";
    assert.ok(html.includes(`<bdi class="text-foreground font-medium">${escaped}</bdi>`));
    assert.ok(!(lines[0] ?? "").includes("Camille"), "never in the headline");
    assert.doesNotMatch(html, /<b>900/);
  });

  test("a name in another script, or another direction, is isolated", () => {
    const html = pageOf(withValues({ customer: { name: "سارة\u202eأحمد", email: "s@example.com" } }));
    assert.match(html, /<bdi class="text-foreground font-medium">سارة/);
  });

  test("a product's name of 300 characters wraps inside its fact on a narrow screen", () => {
    const long = "Kayak ".repeat(50).trim();
    const html = pageOf(
      withValues({ turnoverBuffer: { shortfalls: [short(long, 2, 1)], turnoverBufferMinutes: 120 } }),
    );
    const items = [...html.matchAll(/<li\b class="([^"]*)"/g)].map((match) => match[1] ?? "");
    assert.ok(items.length > 0 && items.every((classes) => /\bmin-w-0\b/.test(classes) && /\boverflow-hidden\b/.test(classes) && /\bwrap-break-word\b/.test(classes)));
    const shown = html.slice(html.indexOf('<div class="min-w-0 space-y-2">'), html.indexOf("</ul>"));
    assert.ok(shown.length > 0);
    assert.doesNotMatch(shown, /(?<![-\w])w-(?:\d|\[)|min-w-\[|whitespace-nowrap|truncate|grid-cols/);
    assert.ok(html.includes(long));
  });

  test("a currency without minor units, and a negative adjustment, are written as such", () => {
    const yen = recordPaymentPresentation(
      { reservationId: RESERVATION, number: "R-1", type: "rental", amount: "1500", method: "cash" },
      "jpy",
    );
    const html = pageOf({ name: "yen", summary: "Record …", presentation: yen });
    assert.ok(screenLines(html).includes("Rental: ¥1,500 received · Cash"));
    const back = pageOf(branchNamed("a negative adjustment"), "fr");
    assert.equal(screenLines(back)[0], "Enregistrer un remboursement au client ?");
    assert.ok(screenLines(back).includes("Ajustement : -20,00 €, remboursés au client · Carte"));
  });

  test("a booking across a change of time in the store's zone is written in its local times", () => {
    // Paris leaves summer time on 25 October 2026: 14:00 is 12:00 UTC before, 13:00 UTC after.
    const html = pageOf(
      withValues({
        reservation: {
          ...statusPreview().reservation,
          startDate: "2026-10-23T12:00:00.000Z",
          endDate: "2026-10-27T13:00:00.000Z",
        },
      }),
      "fr",
    );
    assert.ok(screenLines(html).includes("Du 23 oct. 2026 à 14:00 au 27 oct. 2026 à 14:00 · 98,00 €"));
    const day = pageOf(
      withValues({
        reservation: {
          ...statusPreview().reservation,
          startDate: "2026-12-13T08:00:00.000Z",
          endDate: "2026-12-13T17:00:00.000Z",
        },
      }),
    );
    assert.ok(screenLines(day).includes("On Dec 13, 2026, from 9:00 AM to 6:00 PM · €98.00"));
  });

  test("more short lines than the screen holds: the first, and the others counted; all of them in the details", () => {
    const html = pageOf(
      withValues({
        overbooking: { shortfalls: [short("Paddle", 2, 1), short("Gilet", 4, 2)] },
        turnoverBuffer: { shortfalls: [short("Kayak biplace", 2, 1)], turnoverBufferMinutes: 90 },
      }),
    );
    const lines = screenLines(html);
    assert.equal(lines.length, 6, "a headline and five facts");
    assert.deepEqual(lines.slice(3, 5), [
      "Paddle: 2 requested, only 1 in stock: 1 missing",
      "And 2 more lines past your rules: see Details",
    ]);
    assert.equal(lines[0], "Confirm the booking beyond your stock and your turnover buffer?");
  });

  test("a turnover buffer of an hour and a half reads as one", () => {
    const html = pageOf(
      withValues({ turnoverBuffer: { shortfalls: [short("Kayak", 1, 0)], turnoverBufferMinutes: 90 } }),
    );
    assert.ok(screenLines(html).includes("Kayak: 1 requested, none free with your 1 hr, 30 min turnover buffer"));
  });

  test("without a display the page shows the summary, as for any other action", () => {
    const html = wrap(
      "en",
      <OperationApproval
        action="/handoffs/abcdefghijklmnopqrstu/decide"
        approval={approval({ preview: PREVIEW("Record a rental payment of €120.00 (cash) on reservation #R-00094.") })}
        email="olga@velo-liberte.test"
        note={null}
      />,
    );
    assert.match(visible(html), /Approve a payment\? .* Record a rental payment of €120\.00 \(cash\) on reservation #R-00094\. Only Louez’s summary counts\./);
    assert.doesNotMatch(html, /What your assistant was told/);
  });
});

describe("the display's texts", () => {
  type Texts = { headline: Record<string, string>; facts: Record<string, string>; choices: Record<string, Record<string, string>>; told: string };
  const textsOf = (locale: string) =>
    (messagesOf(locale) as { handoff: { operation_approval: { display: Texts } } }).handoff.operation_approval.display;

  /** A text's own words: its placeholders, tags and select arms' values left out. */
  const words = (text: string) =>
    text
      .replace(/<\/?v>/g, "")
      .replace(/\{[a-zA-Z]+\}/g, "")
      .replace(/\{[a-zA-Z]+, (?:plural|select),/g, "")
      .replace(/(?:=\d+|one|few|many|other|yes|email|sms) \{/g, "")
      .replace(/[^\p{L}]+/gu, " ")
      .trim();

  test("every headline, fact and labelled choice has a text in each of the 13 locales", () => {
    assert.equal(LOCALES.length, 13);
    for (const locale of LOCALES) {
      const texts = textsOf(locale);
      assert.equal(typeof texts.told, "string", locale);
      for (const key of Object.keys(HEADLINES)) assert.ok(texts.headline[key], `${locale}: headline ${key}`);
      for (const key of Object.keys(FACTS)) assert.ok(texts.facts[key], `${locale}: fact ${key}`);
      for (const list of LABELLED_CHOICES) {
        for (const value of CHOICES[list]) assert.ok(texts.choices[list]?.[value], `${locale}: ${list}.${value}`);
      }
      // Nothing more than Louez writes.
      assert.deepEqual(Object.keys(texts.headline).sort(), Object.keys(HEADLINES).sort(), locale);
      assert.deepEqual(Object.keys(texts.facts).sort(), Object.keys(FACTS).sort(), locale);
    }
  });

  test("no English is left in a non-English file for these texts", () => {
    const english = textsOf("en");
    const englishTexts = [
      english.told,
      ...Object.values(english.headline),
      ...Object.values(english.facts),
      ...Object.values(english.choices).flatMap((list) => Object.values(list)),
    ];
    // A brand is the same in every language.
    const same = new Set(["Stripe"]);
    for (const locale of LOCALES.filter((candidate) => candidate !== "en")) {
      const texts = textsOf(locale);
      const pairs: Array<[string, string, string | undefined]> = [
        ["told", english.told, texts.told],
        ...Object.entries(english.headline).map(([key, text]): [string, string, string | undefined] => [`headline.${key}`, text, texts.headline[key]]),
        ...Object.entries(english.facts).map(([key, text]): [string, string, string | undefined] => [`facts.${key}`, text, texts.facts[key]]),
        ...Object.entries(english.choices).flatMap(([list, values]) =>
          Object.entries(values).map(([value, text]): [string, string, string | undefined] => [`choices.${list}.${value}`, text, texts.choices[list]?.[value]]),
        ),
      ];
      for (const [key, text, translated] of pairs) {
        if (words(text) === "" || same.has(text)) continue;
        assert.notEqual(words(translated ?? ""), words(text), `${locale}: ${key} is still English`);
        // Not one English sentence of these texts carried over whole into another one.
        for (const englishText of englishTexts) {
          if (words(englishText).split(" ").length < 3) continue;
          assert.ok(!(translated ?? "").includes(englishText), `${locale}: ${key} holds “${englishText}”`);
        }
      }
    }
  });

  test("every branch renders in every locale: no raw key, no placeholder left, each value in its place", () => {
    for (const locale of LOCALES) {
      for (const branch of BRANCHES) {
        const lines = screenLines(pageOf(branch, locale));
        for (const line of lines) {
          assert.ok(line.length > 0, `${locale}, ${branch.name}`);
          assert.doesNotMatch(line, /[{}]|<\/?v>|display\.|operation_approval/, `${locale}, ${branch.name}: ${line}`);
        }
        assert.ok(lines.some((line) => line.includes("R-00094") || line.includes("Lucas Bernard") || line.includes("nina.roux")), `${locale}, ${branch.name}: the record`);
      }
    }
  });

  test("each value of a text is set apart as data: every placeholder of a value sits in its own tag", () => {
    for (const locale of LOCALES) {
      const texts = textsOf(locale);
      for (const [key, text] of Object.entries(texts.facts)) {
        for (const [name, spec] of Object.entries(FACTS[key as keyof typeof FACTS])) {
          if (spec.type !== "text") continue;
          assert.ok(text.includes(`<v>{${name}}</v>`), `${locale}: facts.${key} sets {${name}} apart`);
        }
      }
      for (const text of Object.values(texts.headline)) assert.doesNotMatch(text, /[{<]/, `${locale}: a headline holds no value`);
    }
  });

  test("a text that names its channels names each one", () => {
    for (const locale of LOCALES) {
      const texts = textsOf(locale);
      for (const key of ["message", "messageToCustomer"]) {
        const text = texts.facts[key] ?? "";
        for (const channel of CHOICES.messageChannels.filter((value) => value !== "email_and_sms")) {
          assert.ok(text.includes(`${channel} {`), `${locale}: ${key} names ${channel}`);
        }
        assert.ok(text.includes("other {"), `${locale}: ${key} names both`);
      }
    }
  });
});
