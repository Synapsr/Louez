import type { RECORDED_PAYMENT_TYPES } from "../contracts/payment-records";
import { describeShortfallLine, type CapacityShortfall } from "../contracts/reservations";
import {
  FACTS_MAX,
  choice,
  count,
  dateRange,
  dateTime,
  duration,
  fact,
  headline,
  isChoice,
  money,
  text,
  type ApprovalPresentation,
  type DisplayFact,
  type FactKey,
  type HeadlineKey,
} from "./approval-display";
import { oneLine } from "./approval-preview";
import {
  depositReturnAmount,
  fromHundredths,
  hundredthsOf,
  recordedPaymentAmount,
  refundAmount,
} from "./payment-amount";
import type { StatusChangePreview } from "./reservation-status";

/**
 * What a person reads first for each branch pull request 7 switches, built
 * from the very values the branch's preview hands an agent, in the call that
 * hands that preview to the check: the display and the request's identity
 * facts are functions of the preview's own fields (and of the record's
 * currency or date, which the preview leaves implicit), so the stored
 * display and the stored summary cannot disagree. Null where the values
 * cannot be shown as typed facts: the page then shows the summary, as for
 * any other action. The two payment writes refuse, before they ask, every
 * input their display could not show (`paymentAmount`, the sign, the
 * balance), so each input they accept has one.
 *
 * Pure, and light: the sample approvals (apps/web/scripts/seed) and the
 * page's tests build their displays with these same functions.
 */

const CURRENCY = /^[A-Za-z]{3}$/;

/** A computed or stored decimal the page shows as it is (a total, a balance): a plain decimal. */
const plainDecimal = (raw: string): string | null =>
  /^-?\d{1,12}(?:\.\d{1,4})?$/.test(raw) ? raw : null;

type RecordedPaymentType = (typeof RECORDED_PAYMENT_TYPES)[number];

/**
 * What a payment recorded through the generic write says, by the type the
 * writer records it as and the amount's sign: its headline and its fact.
 * Total over the types the write accepts (`RECORDED_PAYMENT_TYPES`): a type
 * added there does not compile until it is said here. Null where the write
 * refuses the sign (a negative amount outside an adjustment), so nothing
 * is shown that the writer would not write.
 */
const RECORDED: Record<
  RecordedPaymentType,
  (negative: boolean) => { headline: HeadlineKey; fact: FactKey } | null
> = {
  // Money that comes in.
  rental: (negative) => (negative ? null : { headline: "recordPayment", fact: "received" }),
  damage: (negative) => (negative ? null : { headline: "recordPayment", fact: "received" }),
  // A deposit collected, a deposit given back.
  deposit: (negative) => (negative ? null : { headline: "recordDeposit", fact: "depositCollected" }),
  deposit_return: (negative) =>
    negative ? null : { headline: "returnDeposit", fact: "depositGivenBack" },
  // An adjustment, in either direction.
  adjustment: (negative) =>
    negative
      ? { headline: "paidBack", fact: "paidBack" }
      : { headline: "recordPayment", fact: "received" },
};

const isRecordedType = (type: string): type is RecordedPaymentType => Object.hasOwn(RECORDED, type);

/** The booking a payment is recorded on, named by its number. */
const bookingNumber = (reservationId: string, number: string) =>
  fact("bookingNumber", { number: text(number) }, reservationId);

/**
 * A payment recorded on a reservation (`dashboard.payments.record`): said as
 * what the writer records, by its type (`RECORDED`), with the amount its
 * row will hold (`paymentAmount`).
 */
export function recordPaymentPresentation(
  details: { reservationId: string; number: string; type: string; amount: string; method: string },
  currency: string,
): ApprovalPresentation | null {
  const { type, method } = details;
  // Judged as the write judges it: an amount it refuses gets no display.
  const verdict = recordedPaymentAmount(details.amount, type);
  if (!verdict.ok || !CURRENCY.test(currency) || !isRecordedType(type)) return null;
  if (!isChoice("paymentType", type) || !isChoice("paymentMethod", method)) return null;
  const { amount } = verdict;
  const said = RECORDED[type](amount.startsWith("-"));
  if (!said) return null;
  const values = {
    type: choice("paymentType", type),
    amount: money(amount, currency),
    method: choice("paymentMethod", method),
  };
  return {
    display: {
      headline: headline(said.headline, {}),
      facts: [
        bookingNumber(details.reservationId, details.number),
        fact(said.fact, values),
        fact("recordOnly", {}),
      ],
    },
    facts: {
      reservation: details.reservationId,
      type,
      amount,
      currency: currency.toUpperCase(),
      method,
    },
  };
}

/**
 * A deposit the store gave back, recorded (`dashboard.payments.recordDepositReturn`).
 * `balance` is the deposit still held, as the number the writer compares the
 * amount with: the text in `details.returnable` is that number rounded.
 */
export function recordDepositReturnPresentation(
  details: {
    reservationId: string;
    number: string;
    amount: string;
    method: string;
    returnable: string;
  },
  currency: string,
  balance: number,
): ApprovalPresentation | null {
  // Judged as the write judges it: a return it refuses gets no display.
  const verdict = depositReturnAmount(details.amount, balance);
  const held = plainDecimal(details.returnable);
  const { method } = details;
  if (!verdict.ok || !held || !CURRENCY.test(currency) || !isChoice("paymentMethod", method)) {
    return null;
  }
  const { amount } = verdict;
  return {
    display: {
      headline: headline("returnDeposit", {}),
      facts: [
        bookingNumber(details.reservationId, details.number),
        fact("returned", {
          amount: money(amount, currency),
          method: choice("paymentMethod", method),
        }),
        fact("depositHeld", { held: money(held, currency) }),
        fact("recordOnly", {}),
      ],
    },
    facts: {
      reservation: details.reservationId,
      amount,
      currency: currency.toUpperCase(),
      method,
    },
  };
}

/**
 * A refund the store gave by hand, recorded against one payment
 * (`dashboard.payments.recordRefund`). Every amount is in the payment's own
 * currency, which the refund's row takes. `refundedHundredths` is what the
 * completed refunds linked to it already gave back, in hundredths, as the
 * writer counts it under the reservation's lock.
 */
export function recordRefundPresentation(
  details: {
    paymentId: string;
    reservationId: string;
    number: string;
    amount: string;
    method: string;
  },
  payment: {
    type: string;
    amount: string;
    method: string;
    currency: string;
    paidAt: Date;
    refundedHundredths: number;
    paidHundredths: number;
  },
): ApprovalPresentation | null {
  const refundable = payment.paidHundredths - payment.refundedHundredths;
  // Judged as the write judges it: a refund it refuses gets no display.
  const verdict = refundAmount(details.amount, payment.currency, refundable);
  const paid = plainDecimal(payment.amount);
  const { currency, type } = payment;
  const { method } = details;
  if (!verdict.ok || !paid || !CURRENCY.test(currency)) return null;
  if (!isChoice("paymentType", type) || !isChoice("paymentMethod", payment.method)) return null;
  if (!isChoice("paymentMethod", method)) return null;
  const { amount } = verdict;
  const left = refundable - hundredthsOf(amount);
  return {
    display: {
      headline: headline("recordRefund", {}),
      facts: [
        bookingNumber(details.reservationId, details.number),
        fact("refundGiven", {
          amount: money(amount, currency),
          method: choice("paymentMethod", method),
        }),
        fact(
          "refundOf",
          {
            type: choice("paymentType", type),
            amount: money(paid, currency),
            at: dateTime(payment.paidAt),
            method: choice("paymentMethod", payment.method),
          },
          details.paymentId,
        ),
        fact("refundBalance", {
          refunded: money(fromHundredths(payment.refundedHundredths), currency),
          left: money(fromHundredths(left), currency),
        }),
        fact("recordOnly", {}),
      ],
    },
    facts: {
      payment: details.paymentId,
      reservation: details.reservationId,
      amount,
      currency: currency.toUpperCase(),
      method,
    },
  };
}

/** A recorded payment deleted (`dashboard.payments.delete`). */
export function deletePaymentPresentation(
  details: { paymentId: string; number: string; type: string; amount: string; method: string },
  record: { reservationId: string; currency: string; recordedAt: Date },
): ApprovalPresentation | null {
  // Read from its row: the amount it holds.
  const amount = plainDecimal(details.amount);
  const { type, method } = details;
  const { currency } = record;
  if (!amount || !CURRENCY.test(currency) || !isChoice("paymentType", type)) return null;
  if (!isChoice("paymentMethod", method)) return null;
  return {
    display: {
      headline: headline("deletePayment", {}),
      facts: [
        bookingNumber(record.reservationId, details.number),
        fact(
          "deleted",
          {
            type: choice("paymentType", type),
            amount: money(amount, currency),
            method: choice("paymentMethod", method),
          },
          details.paymentId,
        ),
        fact("recordedOn", { at: dateTime(record.recordedAt) }),
        fact("leavesBalance", {}),
      ],
    },
    facts: { payment: details.paymentId, amount, currency: currency.toUpperCase() },
  };
}

/** A member removed from the store (`dashboard.team.removeMember`). */
export function removeMemberPresentation(member: {
  id: string;
  name: string | null;
  email: string;
  joinedAt: Date;
}): ApprovalPresentation {
  const name = member.name ? oneLine(member.name) : "";
  return {
    display: {
      headline: headline("removeMember", {}),
      facts: [
        name
          ? fact("member", { name: text(member.name ?? ""), email: text(member.email) }, member.id)
          : fact("memberEmail", { email: text(member.email) }, member.id),
        fact("memberSince", { since: dateTime(member.joinedAt) }),
        fact("losesAccess", {}),
      ],
    },
    facts: { member: member.id },
  };
}

/** A pending invitation cancelled (`dashboard.team.cancelInvitation`). */
export function cancelInvitationPresentation(invitation: {
  id: string;
  email: string;
  invitedAt: Date;
}): ApprovalPresentation {
  return {
    display: {
      headline: headline("cancelInvitation", {}),
      facts: [
        fact("invited", { email: text(invitation.email) }, invitation.id),
        fact("invitedOn", { at: dateTime(invitation.invitedAt) }),
        fact("linkStops", {}),
      ],
    },
    facts: { invitation: invitation.id },
  };
}

/** Which channels a status change's messages go on, as one value. */
const channelsOf = (messages: StatusChangePreview["messages"]) => {
  const email = messages.some((entry) => entry.channel === "email");
  const sms = messages.some((entry) => entry.channel === "sms");
  return email && sms ? "email_and_sms" : email ? "email" : "sms";
};

/**
 * A booking confirmed with `allowOverbooking` or `overrideTurnoverBuffer`
 * (`dashboard.reservations.updateStatus`), from its preview; null for any
 * other status change, which pull request 7 does not switch.
 *
 * The record and the customer first, then the dates and the total, then
 * each line that departs from the store's rules, then the message the
 * customer gets. At most `FACTS_MAX` facts: when the short lines would take
 * more, the first is shown and the others are counted in one fact, and
 * every line stays in the details, where the preview lists them all.
 */
export function confirmOverridePresentation(
  preview: StatusChangePreview,
): ApprovalPresentation | null {
  const { reservation, overbooking, turnoverBuffer, messages } = preview;
  if (reservation.to !== "confirmed" || (!overbooking && !turnoverBuffer)) return null;
  // Read from its row: the total it holds.
  const total = plainDecimal(reservation.totalAmount);
  if (!total || !CURRENCY.test(reservation.currency)) return null;

  const beyondStock = overbooking?.shortfalls ?? [];
  const pastBuffer = turnoverBuffer?.shortfalls ?? [];
  const lines: DisplayFact[] = [
    ...beyondStock.map((shortfall) =>
      fact("beyondStock", {
        ...lineValues(shortfall),
        missing: count(Math.max(0, shortfall.requested - shortfall.available)),
      }),
    ),
    ...pastBuffer.map((shortfall) =>
      fact("pastBuffer", {
        ...lineValues(shortfall),
        buffer: duration(turnoverBuffer?.turnoverBufferMinutes ?? 0),
      }),
    ),
  ];
  const customer = preview.customer && oneLine(preview.customer.name) ? preview.customer : null;
  const message = messages[0]?.message ?? null;
  const channels = channelsOf(messages);
  // A change sends one message, on one channel or on both: one fact. To a
  // person who may read customers it says where each goes, as the preview
  // holds it, the one snapshot the binding and the outbox read.
  const email = messages.find((entry) => entry.channel === "email")?.to;
  const phone = messages.find((entry) => entry.channel === "sms")?.to;
  // Whoever the preview names, even by a name that shows nothing: the
  // destination is then on the display, and the name's own fact makes the
  // request unreadable, so it cannot be approved without it.
  const addressed =
    preview.customer && messages.every((entry) => entry.to) ? preview.customer : null;
  const told = !message
    ? fact("noMessage", {})
    : !addressed
      ? fact("messageToCustomer", {
          message: choice("customerMessage", message),
          channels: choice("messageChannels", channels),
        })
      : email && phone
        ? fact("messageEmailAndText", {
            customer: text(addressed.name),
            message: choice("customerMessage", message),
            email: text(email),
            phone: text(phone),
          })
        : fact("message", {
            customer: text(addressed.name),
            message: choice("customerMessage", message),
            channels: choice("messageChannels", channels),
            to: text(email ?? phone ?? ""),
          });

  // The record, the dates and the message hold three places; the lines share the rest.
  const room = FACTS_MAX - 3;
  const departures =
    lines.length === 0
      ? [fact("withinRules", {})]
      : lines.length <= room
        ? lines
        : [...lines.slice(0, room - 1), fact("moreLines", { count: count(lines.length - room + 1) })];

  const key: keyof typeof OVERRIDES_SAID =
    beyondStock.length > 0 && pastBuffer.length > 0
      ? "confirmBeyondStockAndBuffer"
      : beyondStock.length > 0
        ? "confirmBeyondStock"
        : pastBuffer.length > 0
          ? "confirmPastBuffer"
          : "confirmWithinRules";

  return {
    display: {
      headline: headline(key, { to: choice("reservationStatus", "confirmed") }),
      facts: [
        customer
          ? fact(
              "booking",
              { number: text(reservation.number), customer: text(customer.name) },
              reservation.id,
            )
          : fact("bookingNumber", { number: text(reservation.number) }, reservation.id),
        fact("period", {
          period: dateRange(reservation.startDate, reservation.endDate),
          total: money(total, reservation.currency),
        }),
        ...departures,
        told,
      ],
    },
    facts: {
      reservation: reservation.id,
      status: reservation.to,
      // The overrides that pass something, as the headline says them: a
      // refusal of one never cools another down. A flag that passes nothing
      // is no part of it: the binding holds the shortfalls, so a shortage
      // that appears since voids the approval.
      overrides: [...OVERRIDES_SAID[key]],
      // That a message goes, and on which channels, as the screen says them
      // (`CHANNELS_SAID` for the fact that names both by its words);
      // where it goes is the binding's (`recipientsHash`), and the details'.
      message: message ? { message, channels } : null,
    },
  };
}

/**
 * The overrides each headline of a confirmation says it passes: `stock`, a
 * booking beyond the stock; `turnover_buffer`, one past the buffer. The
 * request's identity holds the headline's, so each override in it is on the
 * screen.
 */
export const OVERRIDES_SAID = {
  confirmWithinRules: [],
  confirmBeyondStock: ["stock"],
  confirmPastBuffer: ["turnover_buffer"],
  confirmBeyondStockAndBuffer: ["stock", "turnover_buffer"],
} as const satisfies Partial<Record<HeadlineKey, readonly string[]>>;

/**
 * The channels a message fact names by its words rather than by a value: the
 * fact for a message sent on both. The request's identity holds the same
 * channels, so each is on the screen.
 */
export const CHANNELS_SAID = {
  messageEmailAndText: ["email_and_sms"],
} as const satisfies Partial<Record<FactKey, readonly string[]>>;

const lineValues = (shortfall: CapacityShortfall) => ({
  product: text(describeShortfallLine(shortfall)),
  requested: count(shortfall.requested),
  available: count(shortfall.available),
});
