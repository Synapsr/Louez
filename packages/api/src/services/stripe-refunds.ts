import { db } from "@louez/db";
import { currencyMinorDigits } from "@louez/utils";

import {
  type GetRefundInput,
  type RefundPaymentInput,
  type RefundPaymentOutput,
  stripeRefundErrors,
} from "../contracts/stripe-refunds";
import type {
  StripeRefundRefusal,
  StripeRefundRequest,
  StripeRefundView,
  StripeRefundsPort,
} from "../platform/ports";
import { recordOperationTarget } from "../platform/operations";
import { refundOnlinePresentation } from "./approval-presentations";
import { currencyFit, currencyMinorOf, paymentAmount } from "./payment-amount";
import {
  type PaymentWriteCaller,
  moneyIn,
  refused,
  storePayment,
  unconfirmed,
  underReservationLock,
} from "./payment-records";

/**
 * The refund of a payment taken online, through Stripe, back to the means that paid it
 * (`dashboard.payments.refund`, `refund_payment`; docs/domain/reservation-invariants.md,
 * M9). A person's approval is always asked, for exactly this payment and this amount;
 * the refund is the app's durable operation (`ApiPorts.stripeRefunds`): one approval
 * gives one refund at most, and its outcome can always be read (`getOnlineRefund`).
 *
 * Refused, before anything is asked, for what would be refused whatever anyone answers:
 * the amount, a payment the store does not have or took by hand, one not settled,
 * disputed, a refund row or a hold, a charge on several reservations, and an amount past
 * what the charge can still give back. The approval binds the payment, the amount, the
 * charge and the account, and the charge's state (the payment's status and gross, the
 * refunds that stand on it, the open operations, the disputes ever opened on it): a
 * refund or a dispute landing in between ends it (`state_changed`). The approval is
 * spent only with the operation it gives: a refusal after it was consumed is thrown in
 * the transaction, which rolls the consumption back. The operation is the call's target
 * (`recordOperationTarget`): a key whose answer was lost after the commit is answered
 * with the refund as it is now (`recoverOnlineRefund`). Once the operation is recorded
 * the answer is always the operation's state: `pending` when Stripe has not given the
 * outcome, never an error.
 */

/** Who refunds: the store, the app's service, the confirmation, and who asks. */
export interface StripeRefundCaller extends PaymentWriteCaller<StripeRefundsPort> {
  requestedBy: { userId: string | null; credentialId: string | null };
  /** The approval this call carries out, as presented; null when none is. */
  approvalId: string | null;
}

/** A whole number of a currency's minor units, as a decimal string. */
const decimalOf = (minor: number, currency: string): string => {
  const digits = currencyMinorDigits(currency) ?? 2;
  return (minor / 10 ** digits).toFixed(digits);
};

/** A refusal of the app's service, as the API answers it. */
function refusalError(refusal: StripeRefundRefusal, paymentId: string): Error {
  const currency = typeof refusal.currency === "string" ? refusal.currency : "EUR";
  const minor = (key: string) => (typeof refusal[key] === "number" ? (refusal[key] as number) : 0);
  switch (refusal.code) {
    case "PAYMENT_NOT_FOUND":
      return stripeRefundErrors.paymentNotFound(paymentId);
    case "PAYMENT_NOT_REFUNDABLE":
      return refusal.reason === "not_online"
        ? stripeRefundErrors.takenByHand()
        : stripeRefundErrors.notRefundable(String(refusal.reason ?? ""));
    case "PAYMENT_NOT_SETTLED":
      return stripeRefundErrors.notSettled();
    case "REFUND_AMOUNT_INVALID":
    case "REFUND_CURRENCY_MISMATCH":
      return stripeRefundErrors.amountInvalid();
    case "REFUND_CURRENCY_NOT_SUPPORTED":
      return stripeRefundErrors.currencyNotSupported(currency);
    case "PAYMENT_DISPUTED":
      return stripeRefundErrors.disputed();
    case "PAYMENT_CHARGE_SHARED":
      return stripeRefundErrors.chargeShared(String(refusal.message ?? ""));
    case "NO_STRIPE_ACCOUNT":
      return stripeRefundErrors.noStripeAccount();
    case "REFUND_EXCEEDS_REFUNDABLE":
      return stripeRefundErrors.exceedsRefundable(
        {
          paid: decimalOf(minor("paidMinor"), currency),
          refunded: decimalOf(minor("refundedMinor"), currency),
          inFlight: decimalOf(minor("inFlightMinor"), currency),
          refundable: decimalOf(minor("refundableMinor"), currency),
          currency,
        },
        (amount) => moneyIn(amount, currency),
      );
    default:
      // REFUND_APPROVAL_USED: a backstop no correct flow reaches.
      return stripeRefundErrors.notRefundable(refusal.code.toLowerCase());
  }
}

/** The operation as the procedures answer it. */
export function refundAnswer(
  view: StripeRefundView,
  reservation: { number: string },
): Omit<RefundPaymentOutput, "links"> {
  const open = view.status === "requested" || view.status === "unresolved";
  return {
    refund: {
      id: view.id,
      status: open ? "pending" : view.status === "succeeded" ? "succeeded" : "failed",
      detail: open ? (view.status === "requested" ? "sending" : "awaiting_provider") : null,
      amount: decimalOf(view.amountMinor, view.currency),
      currency: view.currency,
      reason: view.reason,
      createdAt: view.createdAt.toISOString(),
      stripeRefundId: view.stripeRefundId,
      refundPaymentId: view.refundPaymentId,
      failure:
        view.status === "failed"
          ? { code: view.failureCode ?? "failed", message: view.failureMessage }
          : null,
      creditNote: view.creditNote,
    },
    paymentId: view.paymentId,
    reservationId: view.reservationId,
    number: reservation.number,
  };
}

export async function refundOnlinePayment(
  caller: StripeRefundCaller,
  input: RefundPaymentInput,
): Promise<Omit<RefundPaymentOutput, "links">> {
  const { storeId, port } = caller;
  // Refused whatever anyone answers, before anything is read: the text, and zero and below.
  const text = paymentAmount(input.amount);
  if (!text || text.startsWith("-") || Number(text) <= 0) throw stripeRefundErrors.amountInvalid();
  const found = await storePayment(db, storeId, input.paymentId);
  if (!found) throw stripeRefundErrors.paymentNotFound(input.paymentId);
  if (found.method !== "stripe") throw stripeRefundErrors.takenByHand();

  // The charge at Stripe, before any lock: its currency is the refund's.
  let read: Awaited<ReturnType<StripeRefundsPort["readCharge"]>>;
  try {
    read = await port.readCharge({ storeId, paymentId: input.paymentId });
  } catch {
    throw stripeRefundErrors.stripeUnavailable();
  }
  if (!read.ok) throw refusalError(read.refusal, input.paymentId);
  const { charge } = read;
  const currency = charge.currency;
  const fit = currencyFit(text, currency);
  if (fit === "currency_unsupported") throw stripeRefundErrors.currencyNotSupported(currency);
  if (fit === "too_precise") throw stripeRefundErrors.amountInvalid();
  const amountMinor = currencyMinorOf(text, currency);
  const amount = decimalOf(amountMinor, currency);
  const request: StripeRefundRequest = {
    storeId,
    paymentId: input.paymentId,
    amountMinor,
    currency,
    reason: input.reason ?? "requested_by_customer",
    notes: input.notes?.trim() || null,
    charge,
  };

  const recorded = await underReservationLock(storeId, found.reservationId, async (tx) => {
    const checking = await port.check(tx, request);
    if (!checking.ok) return refused(refusalError(checking.refusal, input.paymentId));
    const { checked } = checking;
    const left = checked.ceiling.refundableMinor - amountMinor;
    // What the payment took, before any refund: its row's amount is what it keeps now.
    const paid = decimalOf(checked.ceiling.paidMinor, currency);
    const details = {
      paymentId: found.id,
      reservationId: found.reservationId,
      number: found.number,
      amount,
    };
    const refusal = await caller.confirm(tx, {
      preview: {
        summary: `Refund ${moneyIn(amount, currency)} of the online ${found.type} payment of ${moneyIn(paid, currency)} on reservation #${found.number} to ${charge.card ? `the ${charge.card.brand} card ending ${charge.card.last4}` : "the means that paid"}.`,
        details: {
          ...details,
          currency,
          reason: request.reason,
          payment: { type: found.type, amount: paid, method: found.method },
          alreadyRefunded: decimalOf(checked.ceiling.refundedMinor, currency),
          refundableAfter: decimalOf(left, currency),
          ...(request.notes ? { notes: request.notes } : {}),
        },
      },
      // What the refund is about, and the charge's state it was judged on.
      state: {
        refund: {
          amountMinor,
          currency,
          accountId: checked.accountId,
          chargeId: checked.chargeId,
          reason: request.reason,
        },
        payment: {
          id: found.id,
          reservationId: checked.reservationId,
          status: checked.paymentStatus,
          grossMinor: checked.grossMinor,
        },
        refunds: checked.refunds,
        openOperations: checked.openOperations,
        disputes: checked.disputes,
      },
      presentation: refundOnlinePresentation(
        { ...details, reason: request.reason },
        {
          type: found.type,
          amount: paid,
          method: found.method,
          currency,
          paidAt: found.paidAt ?? found.createdAt,
          refunded: decimalOf(checked.ceiling.refundedMinor, currency),
          refundableAfter: decimalOf(left, currency),
          card: charge.card ?? null,
        },
      ),
    });
    if (refusal) return unconfirmed(refusal);

    const requested = await port.request(tx, {
      ...request,
      approvalId: caller.approvalId,
      requestedBy: caller.requestedBy,
    });
    // The approval was consumed above: a refusal now is thrown, so the transaction rolls
    // the consumption back with it and the approval stays approved. Only what is read
    // unlocked can refuse here (a dispute the webhook committed since the check); the
    // approval binds it, so a later call ends the approval `state_changed` once it is
    // no longer refused for it.
    if (!requested.ok) throw refusalError(requested.refusal, input.paymentId);
    // A key whose answer is lost after the commit is answered with this refund.
    await recordOperationTarget(tx, requested.operationId);
    return {
      ok: true,
      value: { operationId: requested.operationId, effectIds: requested.effectIds },
    };
  });

  // Committed: from here the answer is the operation's state, never an error.
  await port.attempt(recorded.effectIds);
  let view: StripeRefundView | null = null;
  try {
    view = await port.get({
      storeId,
      paymentId: found.id,
      operationId: recorded.operationId,
      reconcile: false,
    });
  } catch {
    view = null;
  }
  return refundAnswer(
    view ?? {
      id: recorded.operationId,
      status: "requested",
      paymentId: found.id,
      reservationId: found.reservationId,
      amountMinor,
      currency,
      reason: request.reason,
      createdAt: new Date(),
      stripeRefundId: null,
      refundPaymentId: null,
      failureCode: null,
      failureMessage: null,
      creditNote: { status: "pending", number: null, needsCorrection: false },
    },
    found,
  );
}

/**
 * The refund a call recorded, as it is now, for its key whose answer was lost after the
 * commit (`meta.recoverUnknown`): read, never settled, never sent again.
 */
export async function recoverOnlineRefund(
  caller: { storeId: string; port: StripeRefundsPort },
  operationId: string,
): Promise<Omit<RefundPaymentOutput, "links">> {
  const view = await caller.port.get({
    storeId: caller.storeId,
    paymentId: null,
    operationId,
    reconcile: false,
  });
  if (!view) throw new Error("The refund an operation recorded is gone.");
  const found = await storePayment(db, caller.storeId, view.paymentId);
  if (!found) throw new Error("The payment an operation refunded is gone.");
  return refundAnswer(view, found);
}

/**
 * The store's refund of that id on that payment, as it stands. An open one is first
 * given one bounded attempt to settle, under the operation's own rules. A refund made in
 * Stripe's own dashboard has no operation: not found here.
 */
export async function getOnlineRefund(
  caller: { storeId: string; port: StripeRefundsPort },
  input: GetRefundInput,
): Promise<Omit<RefundPaymentOutput, "links">> {
  const found = await storePayment(db, caller.storeId, input.paymentId);
  if (!found) throw stripeRefundErrors.paymentNotFound(input.paymentId);
  const view = await caller.port.get({
    storeId: caller.storeId,
    paymentId: found.id,
    operationId: input.refundId,
    reconcile: true,
  });
  if (!view) throw stripeRefundErrors.refundNotFound(input.refundId);
  return refundAnswer(view, found);
}
