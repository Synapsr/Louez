import { and, eq, inArray, isNotNull, isNull, ne, or, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";

import type { Transaction } from "./index";
import { payments } from "./schema";

/**
 * Whether Louez knows what became of a rental row's Checkout Session. A session is
 * settled when its row was paid (`completed`, or `refunded` since) or when Louez
 * learnt from Stripe that it can no longer be paid (`payments.session_settled_at`).
 * An unsettled session is a rental row with a session id, `pending` or `cancelled`
 * (a resume cancels the rows it replaces before it expires their sessions), whose
 * mark is null: Stripe may still take its payment. Every reader of that question
 * uses this definition: the resumed payment, the abandoned checkout's cancellation
 * and the pass over abandoned checkouts.
 */
const UNSETTLED_SESSION_STATUSES = ["pending", "cancelled"] as const;

/** The columns the question reads: those of `payments`, or of an alias of it. */
type PaymentSessionColumns = Record<
  "type" | "stripeCheckoutSessionId" | "status" | "sessionSettledAt",
  AnyMySqlColumn
>;

/**
 * The rental rows of a reservation's own checkout sessions: every rental row
 * with a session but a payment request's (`origin: "payment_request"`), which is
 * the store's request and never makes a reservation a checkout to abandon. The
 * storefront checkout's first row (`checkout`), its resumes (`customer_session`,
 * which the account page writes only on a reservation no longer pending) and the
 * rows written before the column (`null`) are.
 */
export function checkoutSessionRowIn(
  table: Record<"type" | "stripeCheckoutSessionId" | "origin", AnyMySqlColumn>,
): SQL {
  return and(
    eq(table.type, "rental"),
    isNotNull(table.stripeCheckoutSessionId),
    or(isNull(table.origin), ne(table.origin, "payment_request")),
  ) as SQL;
}

/** The same question asked of a row already read. */
export function isCheckoutSessionRow(row: {
  readonly type: string;
  readonly stripeCheckoutSessionId: string | null;
  readonly origin: string | null;
}): boolean {
  return (
    row.type === "rental" &&
    row.stripeCheckoutSessionId !== null &&
    row.origin !== "payment_request"
  );
}

/** The unsettled sessions among the rows of `table` (`payments` or an alias of it). */
export function unsettledCheckoutSessionIn(table: PaymentSessionColumns): SQL {
  return and(
    eq(table.type, "rental"),
    isNotNull(table.stripeCheckoutSessionId),
    inArray(table.status, [...UNSETTLED_SESSION_STATUSES]),
    isNull(table.sessionSettledAt),
  ) as SQL;
}

/** The unsettled sessions among `payments` rows, as a condition of a query. */
export const unsettledCheckoutSession: SQL = unsettledCheckoutSessionIn(payments);

/** The same question asked of a row already read. */
export function isUnsettledCheckoutSession(row: {
  readonly type: string;
  readonly status: string;
  readonly stripeCheckoutSessionId: string | null;
  readonly sessionSettledAt: Date | null;
}): boolean {
  return (
    row.type === "rental" &&
    row.stripeCheckoutSessionId !== null &&
    (UNSETTLED_SESSION_STATUSES as readonly string[]).includes(row.status) &&
    row.sessionSettledAt === null
  );
}

/**
 * Marks a row's session settled: Stripe said it can no longer be paid. A
 * conditional update of that row alone, on a row still unmarked; a failed write
 * leaves it unsettled, which only means it is read again. Returns whether this
 * call marked it.
 */
export async function markCheckoutSessionSettled(
  executor: Pick<Transaction, "update">,
  paymentId: string,
): Promise<boolean> {
  const [marked] = await executor
    .update(payments)
    .set({ sessionSettledAt: new Date() })
    .where(and(eq(payments.id, paymentId), isNull(payments.sessionSettledAt)));
  return marked.affectedRows > 0;
}
