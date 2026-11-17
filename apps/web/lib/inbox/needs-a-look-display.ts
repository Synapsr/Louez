import type { NeedsALookItem } from "./needs-a-look";

/**
 * How an item that needs a look reads in the dashboard, from its kind and its
 * structured details only, never from the API's English summary: message keys
 * under `dashboard.needsALook` and the values they take, already formatted.
 * The row shows the title and one line; the disclosure the sentences and the
 * facts. Ids go only in the facts, and an outbox error never shows.
 */

export interface DisplayFormat {
  /** An amount in its currency, as the dashboard writes money. */
  money: (amount: string | number, currency: string) => string;
  /** A day, in the store's time zone. */
  day: (iso: string | Date) => string;
}

export interface DisplayMessage {
  key: string;
  values?: Record<string, string>;
}

export interface DisplayFact {
  /** Key of the fact's label. */
  label: string;
  value: string;
}

export interface NeedsALookAction {
  /** Key of the action's label. */
  label: string;
  href: string;
}

export interface NeedsALookDisplay {
  title: DisplayMessage;
  /** The one line under the title: booking · customer · amount, what applies. */
  line: string[];
  /** Sentences in the disclosure, the first one saying what happened and what to do. */
  sentences: DisplayMessage[];
  /** References in the disclosure: Stripe ids, invoice numbers, the channel. */
  facts: DisplayFact[];
  action: NeedsALookAction | null;
  /** A second link in the disclosure, when the fix is elsewhere. */
  secondary: NeedsALookAction | null;
  /** Marking it handled leaves an amount held back: the confirmation says so. */
  heldBack: boolean;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

const reservationHref = (id: string, anchor?: "payment") =>
  `/dashboard/reservations/${id}${anchor ? `#${anchor}` : ""}`;

const viewPayment = (id: string | null): NeedsALookAction | null =>
  id ? { label: "actions.viewPayment", href: reservationHref(id, "payment") } : null;

const viewBooking = (id: string | null): NeedsALookAction | null =>
  id ? { label: "actions.viewBooking", href: reservationHref(id) } : null;

/** Stripe statuses where the store must answer the dispute (services/inbox.ts). */
const DISPUTE_NEEDS_RESPONSE = ["needs_response", "warning_needs_response"];

/** Customer messages the dashboard names; any other is "message". */
export const MESSAGE_NAMES = [
  "customer_request_accepted",
  "customer_request_rejected",
  "customer_reservation_cancelled",
  "customer_reservation_modified",
  "customer_quote_sent",
  "customer_reservation_confirmed",
] as const;

/**
 * Why the outbox gave up on a message at once (services/inbox.ts `GIVEN_UP_AT_ONCE`):
 * the sentence the disclosure says, and the short phrase the title carries
 * (`messageNotSent.titleWhy`), wherever the item shows, the bell included.
 */
const MESSAGE_REASONS: Record<string, { sentence: string; why: string }> = {
  recipient_changed: { sentence: "messageNotSent.reasons.recipientChanged", why: "recipient" },
  email_not_configured: { sentence: "messageNotSent.reasons.emailNotConfigured", why: "email" },
  sms_not_configured: { sentence: "messageNotSent.reasons.smsNotConfigured", why: "sms" },
  invalid_payload: { sentence: "messageNotSent.reasons.writtenWrong", why: "written" },
  row_mismatch: { sentence: "messageNotSent.reasons.writtenWrong", why: "written" },
};

/**
 * Why a credit note was not issued, read from the outbox's error to pick a
 * sentence, never to show it: a refund that does not match it, a refund not
 * settled yet, or anything else.
 */
export function creditNoteReason(lastError: unknown): "mismatch" | "pending" | "unknown" {
  const error = text(lastError) ?? "";
  if (/^Abandoned: (payload_invalid|row_mismatch|refund_mismatch)\b/.test(error)) return "mismatch";
  if (/still pending/.test(error)) return "pending";
  return "unknown";
}

/** Each kind's title, also for a row whose details could not be read. */
const TITLES: Record<NeedsALookItem["type"], string> = {
  refund_unconfirmed: "refundUnconfirmed.title",
  refund_undone: "refundUndone.title",
  credit_note_not_issued: "creditNoteNotIssued.title",
  deposit_unconfirmed: "depositUnconfirmed.title",
  deposit_release_failed: "depositReleaseFailed.title",
  dispute_open: "disputeOpen.title",
  einvoice_rejected: "einvoiceRejected.titleRejected",
  message_not_sent: "messageNotSent.title",
  invitation_not_sent: "invitationNotSent.title",
  operation_unknown: "operationUnknown.title",
};

/** Said when a sentence would miss one of its values: nothing wrong, nothing blank. */
const NEUTRAL: DisplayMessage = { key: "neutral" };

const safely = <T>(make: () => T): T | null => {
  try {
    return make();
  } catch {
    return null;
  }
};

/** A row from what can be read of any item, whatever its details: the kind's title and the neutral sentence. */
function neutralDisplay(item: NeedsALookItem): NeedsALookDisplay {
  const reservation = item.reservation;
  const number = typeof reservation?.number === "string" ? reservation.number : null;
  const customer = typeof reservation?.customerName === "string" ? reservation.customerName : null;
  return {
    title: { key: TITLES[item.type] ?? "unknownTitle" },
    line: [number ? `#${number}` : null, customer].filter((part): part is string => Boolean(part)),
    sentences: [NEUTRAL],
    facts: [],
    action: viewBooking(typeof reservation?.id === "string" ? reservation.id : null),
    secondary: null,
    heldBack: item.type === "refund_unconfirmed",
  };
}

/**
 * The row of an item. Total: for any details (missing, of another type, an invalid
 * currency or date) or a kind it does not know, it returns a row and never throws;
 * a sentence that would miss a value gives way to the neutral one.
 */
export function describeNeedsALookItem(
  item: NeedsALookItem,
  format: DisplayFormat,
): NeedsALookDisplay {
  const display = safely(() => describeItem(item, format));
  if (!display) return neutralDisplay(item);
  const blank = display.sentences.some((sentence) =>
    Object.values(sentence.values ?? {}).some((value) => value === ""),
  );
  return blank ? { ...display, sentences: [NEUTRAL] } : display;
}

function describeItem(item: NeedsALookItem, format: DisplayFormat): NeedsALookDisplay | null {
  const d: NeedsALookItem["details"] = item.details ?? {};
  const reservationId = text(d.reservationId) ?? text(item.reservation?.id) ?? null;
  const number = text(d.reservationNumber) ?? text(item.reservation?.number) ?? "";
  const customer = text(item.reservation?.customerName);
  const currency = text(d.currency);
  const amountValue =
    typeof d.amount === "string" || typeof d.amount === "number" ? Number(d.amount) : Number.NaN;
  const amount =
    Number.isFinite(amountValue) && currency && /^[A-Za-z]{3}$/.test(currency)
      ? safely(() => format.money(d.amount as string | number, currency.toUpperCase()))
      : null;
  /** A day, or "" when the value is not one. */
  const dayOf = (value: unknown): string => {
    const date = value instanceof Date ? value : text(value);
    if (!date || Number.isNaN(new Date(date).getTime())) return "";
    return safely(() => format.day(date)) ?? "";
  };
  const booking = number ? `#${number}` : null;
  const line = [booking, customer, amount].filter((part): part is string => Boolean(part));
  const base = {
    line,
    facts: [] as DisplayFact[],
    action: null as NeedsALookAction | null,
    secondary: null as NeedsALookAction | null,
    heldBack: false,
  };
  const values = { number, amount: amount ?? "" };

  switch (item.type) {
    case "refund_unconfirmed": {
      return {
        ...base,
        title: { key: "refundUnconfirmed.title" },
        sentences: [
          {
            key: "refundUnconfirmed.summary",
            values: { ...values, day: dayOf(d.askedAt) },
          },
          { key: "refundUnconfirmed.heldBack" },
        ],
        facts: fact("facts.stripeCharge", d.chargeId),
        action: viewPayment(reservationId),
        heldBack: true,
      };
    }
    case "refund_undone": {
      const creditNote = text(d.creditNoteNumber);
      return {
        ...base,
        title: { key: "refundUndone.title" },
        sentences: [
          {
            key:
              d.listedAfterFailure === true ? "refundUndone.summaryListed" : "refundUndone.summary",
            values,
          },
          ...(creditNote ? [{ key: "refundUndone.creditNote", values: { creditNote } }] : []),
        ],
        facts: [...fact("facts.stripeRefund", d.refundId), ...fact("facts.creditNote", creditNote)],
        action: viewPayment(reservationId),
      };
    }
    case "credit_note_not_issued":
      return {
        ...base,
        title: { key: "creditNoteNotIssued.title" },
        sentences: [
          { key: "creditNoteNotIssued.summary", values },
          { key: `creditNoteNotIssued.reasons.${creditNoteReason(d.lastError)}` },
        ],
        action: viewPayment(reservationId),
        secondary: { label: "actions.invoicingSettings", href: "/dashboard/settings/invoicing" },
      };
    case "deposit_unconfirmed": {
      const unmatched = text(d.unmatchedPaymentIntentId);
      return {
        ...base,
        title: { key: "depositUnconfirmed.title" },
        sentences: [
          {
            key: unmatched ? "depositUnconfirmed.summaryUnmatched" : "depositUnconfirmed.summary",
            values: { ...values, day: dayOf(d.askedAt) },
          },
        ],
        facts: fact("facts.stripePayment", unmatched),
        action: viewPayment(reservationId),
      };
    }
    case "deposit_release_failed":
      return {
        ...base,
        title: { key: "depositReleaseFailed.title" },
        sentences: [{ key: "depositReleaseFailed.summary", values }],
        facts: fact("facts.stripePayment", d.paymentIntentId),
        action: viewPayment(reservationId),
      };
    case "dispute_open": {
      const needsResponse = DISPUTE_NEEDS_RESPONSE.includes(text(d.stripeStatus) ?? "");
      return {
        ...base,
        title: { key: "disputeOpen.title" },
        sentences: [
          {
            key: needsResponse ? "disputeOpen.summaryAnswer" : "disputeOpen.summaryReview",
            values,
          },
        ],
        facts: fact("facts.stripeDispute", d.disputeId),
        action: viewPayment(reservationId),
      };
    }
    case "einvoice_rejected": {
      const rejected = d.transmissionStatus === "rejected";
      const invoice = text(d.invoiceNumber) ?? "";
      return {
        ...base,
        title: {
          key: rejected ? "einvoiceRejected.titleRejected" : "einvoiceRejected.titleNotSent",
        },
        line: [booking, customer, invoice].filter((part): part is string => Boolean(part)),
        sentences: [
          {
            key: rejected ? "einvoiceRejected.summaryRejected" : "einvoiceRejected.summaryNotSent",
            values: { number, invoice },
          },
        ],
        facts: fact("facts.invoice", invoice),
        action: viewBooking(reservationId),
      };
    }
    case "message_not_sent": {
      const toCustomer = d.audience === "customer";
      const notification = text(d.notification);
      const message = (MESSAGE_NAMES as readonly string[]).includes(notification ?? "")
        ? (notification as string)
        : "other";
      const reason = MESSAGE_REASONS[text(d.reason) ?? ""];
      const channel = text(d.channel);
      return {
        ...base,
        title: reason
          ? { key: "messageNotSent.titleWhy", values: { why: reason.why } }
          : { key: "messageNotSent.title" },
        line: [booking, customer].filter((part): part is string => Boolean(part)),
        sentences: [
          toCustomer
            ? number
              ? { key: "messageNotSent.toCustomer", values: { number, message } }
              : { key: "messageNotSent.toCustomerNoBooking" }
            : number
              ? { key: "messageNotSent.toStore", values: { number } }
              : { key: "messageNotSent.toStoreNoBooking" },
          ...(reason ? [{ key: reason.sentence }] : []),
        ],
        facts:
          channel === "email" || channel === "sms"
            ? [{ label: "facts.channel", value: channel === "email" ? "E-mail" : "SMS" }]
            : [],
        action: toCustomer
          ? viewBooking(reservationId)
          : { label: "actions.notificationSettings", href: "/dashboard/settings/notifications" },
      };
    }
    case "invitation_not_sent": {
      const email = text(d.email) ?? "";
      return {
        ...base,
        title: { key: "invitationNotSent.title" },
        line: email ? [email] : [],
        sentences: [{ key: "invitationNotSent.summary", values: { email } }],
        action: { label: "actions.openTeam", href: "/dashboard/team" },
      };
    }
    case "operation_unknown": {
      const client = text(d.clientName);
      const day = dayOf(item.occurredAt);
      const procedure = text(d.procedure) ?? "";
      const target = text(d.targetId);
      return {
        ...base,
        title: { key: "operationUnknown.title" },
        line: [client, day].filter((part): part is string => Boolean(part)),
        sentences: [
          client
            ? { key: "operationUnknown.summaryBy", values: { client, day } }
            : { key: "operationUnknown.summary", values: { day } },
        ],
        facts: fact("facts.reference", d.operationId),
        action:
          target && procedure.startsWith("dashboard.reservations.")
            ? viewBooking(target)
            : target && procedure.startsWith("dashboard.products.")
              ? { label: "actions.viewProduct", href: `/dashboard/products/${target}` }
              : null,
      };
    }
    default:
      // A kind this dashboard does not know yet.
      return null;
  }
}

function fact(label: string, value: unknown): DisplayFact[] {
  const shown = text(value);
  return shown ? [{ label, value: shown }] : [];
}
