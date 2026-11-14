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
} from "./approval-display";
import { oneLine } from "./approval-preview";
import type { StatusChangePreview } from "./reservation-status";

/**
 * What a person reads first for each branch pull request 7 switches, built
 * from the very values the branch's preview hands an agent, in the call that
 * hands that preview to the check: the display and the request's identity
 * facts are functions of the preview's own fields (and of the record's
 * currency or date, which the preview leaves implicit), so the stored
 * display and the stored summary cannot disagree. Null where the values
 * cannot be shown as typed facts (an amount that is not a number, which the
 * write refuses anyway): the page then shows the summary, as for any other
 * action.
 *
 * Pure, and light: the sample approvals (apps/web/scripts/seed) and the
 * page's tests build their displays with these same functions.
 */

/** An amount as the write reads it: a decimal written as text, at most four decimals. */
const AMOUNT = /^-?\d{1,12}(?:\.\d{1,4})?$/;
const CURRENCY = /^[A-Za-z]{3}$/;

const amountOf = (raw: string): string | null => {
  const trimmed = raw.trim();
  return AMOUNT.test(trimmed) ? trimmed : null;
};

/** The booking a payment is recorded on, named by its number. */
const bookingNumber = (reservationId: string, number: string) =>
  fact("bookingNumber", { number: text(number) }, reservationId);

/** A payment recorded on a reservation (`dashboard.payments.record`). */
export function recordPaymentPresentation(
  details: { reservationId: string; number: string; type: string; amount: string; method: string },
  currency: string,
): ApprovalPresentation | null {
  const amount = amountOf(details.amount);
  const { type, method } = details;
  if (!amount || !CURRENCY.test(currency) || !isChoice("paymentType", type)) return null;
  if (!isChoice("paymentMethod", method)) return null;
  const paidBack = type === "adjustment" && Number(amount) < 0;
  const values = {
    type: choice("paymentType", type),
    amount: money(amount, currency),
    method: choice("paymentMethod", method),
  };
  return {
    display: {
      headline: headline(paidBack ? "paidBack" : "recordPayment", {}),
      facts: [
        bookingNumber(details.reservationId, details.number),
        fact(paidBack ? "paidBack" : "received", values),
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

/** A deposit the store gave back, recorded (`dashboard.payments.recordDepositReturn`). */
export function recordDepositReturnPresentation(
  details: {
    reservationId: string;
    number: string;
    amount: string;
    method: string;
    returnable: string;
  },
  currency: string,
): ApprovalPresentation | null {
  const amount = amountOf(details.amount);
  const held = amountOf(details.returnable);
  const { method } = details;
  if (!amount || !held || !CURRENCY.test(currency) || !isChoice("paymentMethod", method)) {
    return null;
  }
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

/** A recorded payment deleted (`dashboard.payments.delete`). */
export function deletePaymentPresentation(
  details: { paymentId: string; number: string; type: string; amount: string; method: string },
  record: { reservationId: string; currency: string; recordedAt: Date },
): ApprovalPresentation | null {
  const amount = amountOf(details.amount);
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
  const total = amountOf(reservation.totalAmount);
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
  const told = message
    ? customer
      ? fact("message", {
          customer: text(customer.name),
          message: choice("customerMessage", message),
          channels: choice("messageChannels", channels),
        })
      : fact("messageToCustomer", {
          message: choice("customerMessage", message),
          channels: choice("messageChannels", channels),
        })
    : fact("noMessage", {});

  // The record, the dates and the message hold three places; the lines share the rest.
  const room = FACTS_MAX - 3;
  const departures =
    lines.length === 0
      ? [fact("withinRules", {})]
      : lines.length <= room
        ? lines
        : [...lines.slice(0, room - 1), fact("moreLines", { count: count(lines.length - room + 1) })];

  const key =
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
      message: message ? { message, channels } : null,
    },
  };
}

const lineValues = (shortfall: CapacityShortfall) => ({
  product: text(describeShortfallLine(shortfall)),
  requested: count(shortfall.requested),
  available: count(shortfall.available),
});
