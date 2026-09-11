/**
 * The customer's reading of a reservation deposit: one state built from the
 * Stripe deposit status, the hold expiry and the manual deposit payments,
 * so the account page can say where the money stands without exposing the
 * store's internal vocabulary (card_saved, requires_capture, …).
 */

export interface DepositPaymentLike {
  type: string;
  status: string;
  method: string;
  amount: string | number;
  notes?: string | null;
  paidAt?: Date | null;
  createdAt: Date;
}

export interface CustomerDepositInput {
  depositAmount: string | number;
  depositStatus: string | null;
  depositAuthorizationExpiresAt: Date | null;
  payments: readonly DepositPaymentLike[];
  now?: Date;
}

export type CustomerDepositView =
  | { kind: "not_required" }
  /** No card known for the deposit: the store collects it at pickup. */
  | { kind: "to_provide"; amount: number }
  /** Card saved at checkout, hold not placed yet. */
  | { kind: "card_saved"; amount: number }
  | { kind: "held"; amount: number; expiresAt: Date | null }
  | { kind: "hold_expired"; amount: number }
  | { kind: "released"; amount: number }
  | {
      kind: "captured";
      amount: number;
      capturedAmount: number;
      releasedAmount: number;
      reason: string | null;
      capturedAt: Date | null;
    }
  | { kind: "failed"; amount: number }
  /** Cash, cheque or transfer received by the store. */
  | { kind: "collected"; amount: number; method: string; receivedAt: Date | null }
  | {
      kind: "returned";
      amount: number;
      returnedAmount: number;
      method: string;
      returnedAt: Date | null;
      partial: boolean;
    };

export const DEPOSIT_HOLD_DAYS = 7;

const toAmount = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  const amount = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(amount) ? amount : 0;
};

const completed = (payments: readonly DepositPaymentLike[], type: string) =>
  payments.filter((payment) => payment.type === type && payment.status === "completed");

const latest = (payments: readonly DepositPaymentLike[]): DepositPaymentLike | undefined =>
  [...payments].sort(
    (a, b) => (b.paidAt ?? b.createdAt).getTime() - (a.paidAt ?? a.createdAt).getTime(),
  )[0];

const sum = (payments: readonly DepositPaymentLike[]): number =>
  payments.reduce((total, payment) => total + toAmount(payment.amount), 0);

export const getCustomerDepositView = ({
  depositAmount,
  depositStatus,
  depositAuthorizationExpiresAt,
  payments,
  now = new Date(),
}: CustomerDepositInput): CustomerDepositView => {
  const amount = toAmount(depositAmount);
  const collected = completed(payments, "deposit");
  const returned = completed(payments, "deposit_return");

  if (amount <= 0 && collected.length === 0) return { kind: "not_required" };

  // A live or settled card hold is the most precise information there is.
  if (depositStatus === "authorized") {
    if (depositAuthorizationExpiresAt && depositAuthorizationExpiresAt < now) {
      return { kind: "hold_expired", amount };
    }
    return { kind: "held", amount, expiresAt: depositAuthorizationExpiresAt };
  }
  if (depositStatus === "captured") {
    const capture = latest(completed(payments, "deposit_capture"));
    const capturedAmount = capture ? toAmount(capture.amount) : amount;
    return {
      kind: "captured",
      amount,
      capturedAmount,
      releasedAmount: Math.max(0, amount - capturedAmount),
      reason: capture?.notes?.trim() || null,
      capturedAt: capture?.paidAt ?? capture?.createdAt ?? null,
    };
  }
  if (depositStatus === "released") return { kind: "released", amount };

  // Money the store took by hand (cash, cheque, transfer).
  if (collected.length > 0) {
    const collectedAmount = sum(collected);
    const receipt = latest(collected);
    if (returned.length > 0) {
      const refund = latest(returned);
      const returnedAmount = sum(returned);
      return {
        kind: "returned",
        amount: collectedAmount,
        returnedAmount,
        method: refund?.method ?? "other",
        returnedAt: refund?.paidAt ?? refund?.createdAt ?? null,
        partial: returnedAmount < collectedAmount,
      };
    }
    return {
      kind: "collected",
      amount: collectedAmount,
      method: receipt?.method ?? "other",
      receivedAt: receipt?.paidAt ?? receipt?.createdAt ?? null,
    };
  }

  if (depositStatus === "failed") return { kind: "failed", amount };
  if (depositStatus === "card_saved") return { kind: "card_saved", amount };
  return { kind: "to_provide", amount };
};

export interface DepositAuthorizationWindowInput {
  view: CustomerDepositView;
  status: string;
  startDate: Date;
  stripeActive: boolean;
  now?: Date;
}

const AUTHORIZABLE_KINDS: ReadonlySet<CustomerDepositView["kind"]> = new Set([
  "to_provide",
  "card_saved",
  "failed",
]);

/**
 * A card hold lasts seven days, so the customer is only offered to place it
 * once pickup is that close (or the rental has started), on a confirmed
 * reservation of a store that takes card payments.
 */
export const canAuthorizeDepositOnline = ({
  view,
  status,
  startDate,
  stripeActive,
  now = new Date(),
}: DepositAuthorizationWindowInput): boolean => {
  if (!stripeActive || !AUTHORIZABLE_KINDS.has(view.kind)) return false;
  if (status !== "confirmed" && status !== "ongoing") return false;
  const windowMs = DEPOSIT_HOLD_DAYS * 24 * 60 * 60 * 1000;
  return startDate.getTime() - now.getTime() <= windowMs;
};
