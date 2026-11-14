import type { RECORDED_PAYMENT_TYPES } from "../contracts/payment-records";
import { describeShortfallLine, type CapacityShortfall } from "../contracts/reservations";
import { sha256, stableStringify } from "../platform/hash";
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

const CURRENCY = /^[A-Za-z]{3}$/;

/** The digits a payment's amount keeps: `payments.amount`, `decimal(10,2)`. */
const AMOUNT_PRECISION = 10;
const AMOUNT_SCALE = 2;

/**
 * The amount a `decimal(10,2)` column holds once the write assigns it the
 * text it was given, as MySQL assigns it: a plain decimal ("1.234",
 * "-20.005", "007.5") rounded half away from zero to two decimals, every
 * decimal written ("120" holds "120.00"), no negative zero; null for a text
 * MySQL would not store as written (spaces, a sign `+`, an exponent) or
 * one past the column's eight integer digits, which the write refuses. The
 * writer hands the column the amount as it was sent
 * (apps/web lib/reservations/dashboard-payment-writes.ts), so this is the
 * amount the row will hold, which the display shows, digit for digit
 * (approval-branches.db.test.ts compares it with the rows MySQL writes).
 */
export function storedAmount(raw: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const [, sign, whole = "", fraction = ""] = match;
  let units = BigInt(whole + (fraction + "0".repeat(AMOUNT_SCALE)).slice(0, AMOUNT_SCALE));
  if ((fraction.charAt(AMOUNT_SCALE) || "0") >= "5") units += BigInt(1);
  if (units >= BigInt(10) ** BigInt(AMOUNT_PRECISION)) return null;
  const digits = units.toString().padStart(AMOUNT_SCALE + 1, "0");
  const text = `${digits.slice(0, -AMOUNT_SCALE)}.${digits.slice(-AMOUNT_SCALE)}`;
  return sign && units !== BigInt(0) ? `-${text}` : text;
}

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
 * row will hold (`storedAmount`).
 */
export function recordPaymentPresentation(
  details: { reservationId: string; number: string; type: string; amount: string; method: string },
  currency: string,
): ApprovalPresentation | null {
  const amount = storedAmount(details.amount);
  const { type, method } = details;
  if (!amount || !CURRENCY.test(currency) || !isRecordedType(type)) return null;
  if (!isChoice("paymentType", type) || !isChoice("paymentMethod", method)) return null;
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
  const amount = storedAmount(details.amount);
  const held = plainDecimal(details.returnable);
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
  recipients: readonly MessageRecipient[],
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
      recipients: recipientHashes(recipients),
    },
  };
}

/** Where a customer message goes: its channel and the address it goes to, as the store holds it. */
export interface MessageRecipient {
  channel: "email" | "sms";
  to: string | null | undefined;
}

/**
 * Who a status change's messages go to, as the request's identity holds
 * them: per recipient, the SHA-256 (hex) of the canonical JSON of its
 * channel and its address, the e-mail trimmed and lowercased, the phone
 * number with its blanks removed (`{"channel":"email","to":"camille@example.com"}`),
 * sorted. Never the address itself, and never the message's language,
 * which the binding covers (`recipientsHash`).
 */
export function recipientHashes(recipients: readonly MessageRecipient[]): string[] {
  return recipients
    .map(({ channel, to }) => {
      const address = (to ?? "").trim();
      return sha256(
        stableStringify({
          channel,
          to: channel === "email" ? address.toLowerCase() : address.replace(/\s+/g, ""),
        }),
      );
    })
    .sort();
}

const lineValues = (shortfall: CapacityShortfall) => ({
  product: text(describeShortfallLine(shortfall)),
  requested: count(shortfall.requested),
  available: count(shortfall.available),
});
