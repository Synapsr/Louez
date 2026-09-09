import type { ReservationMode } from "./checkout.types";

/** Stripe refuses charges under this amount; mirrors the server rule. */
const MINIMUM_CHARGE_AMOUNT = 0.5;

export interface CheckoutTotalsInput {
  /** Rental lines after tier discounts, before promo. */
  subtotal: number;
  /** Promo discount already capped to the subtotal by the server. */
  discountAmount: number;
  deliveryFee: number;
  /** Estimated Tulip premium when the opt-in applies, else 0. */
  insuranceAmount: number;
  /** Online deposit percentage (1-100); 100 = full payment. */
  depositPercentage: number;
  reservationMode: ReservationMode;
}

export interface CheckoutTotals {
  subtotalWithInsurance: number;
  /** What the reservation costs: subtotal − promo + delivery + insurance. */
  total: number;
  isPartialPayment: boolean;
  /** Charged at checkout in payment mode (full total or the deposit). */
  amountDueNow: number;
  /** Left to pay at pickup when a deposit is charged online. */
  remainingAmount: number;
}

export type CheckoutSubmitLabel =
  | { kind: "request" }
  | { kind: "pay"; amount: number }
  | { kind: "payDeposit"; amount: number };

const roundToCents = (amount: number): number => Math.round(amount * 100) / 100;

/**
 * Single source for the summary, the deposit line and the submit label.
 * The partial deposit follows the server (`getCheckoutChargeAmount`): a
 * percentage of the full total, delivery and insurance included, floored to
 * the Stripe minimum and capped to the total.
 */
export const calculateCheckoutTotals = ({
  subtotal,
  discountAmount,
  deliveryFee,
  insuranceAmount,
  depositPercentage,
  reservationMode,
}: CheckoutTotalsInput): CheckoutTotals => {
  const subtotalWithInsurance = roundToCents(subtotal + insuranceAmount);
  const total = roundToCents(
    Math.max(0, subtotal - discountAmount) + deliveryFee + insuranceAmount,
  );
  const isPartialPayment = reservationMode === "payment" && depositPercentage < 100;

  if (!isPartialPayment) {
    return {
      subtotalWithInsurance,
      total,
      isPartialPayment: false,
      amountDueNow: reservationMode === "payment" ? total : 0,
      remainingAmount: reservationMode === "payment" ? 0 : total,
    };
  }

  const rawDeposit = roundToCents(total * depositPercentage) / 100;
  const amountDueNow = roundToCents(Math.min(Math.max(rawDeposit, MINIMUM_CHARGE_AMOUNT), total));

  return {
    subtotalWithInsurance,
    total,
    isPartialPayment: true,
    amountDueNow,
    remainingAmount: roundToCents(total - amountDueNow),
  };
};

export const getCheckoutSubmitLabel = (
  totals: CheckoutTotals,
  reservationMode: ReservationMode,
): CheckoutSubmitLabel => {
  if (reservationMode !== "payment") {
    return { kind: "request" };
  }
  return totals.isPartialPayment
    ? { kind: "payDeposit", amount: totals.amountDueNow }
    : { kind: "pay", amount: totals.amountDueNow };
};
