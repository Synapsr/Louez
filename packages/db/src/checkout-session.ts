import { and, eq, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";

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

/** The unsettled sessions among `payments` rows, as a condition of a query. */
export const unsettledCheckoutSession: SQL = and(
  eq(payments.type, "rental"),
  isNotNull(payments.stripeCheckoutSessionId),
  inArray(payments.status, [...UNSETTLED_SESSION_STATUSES]),
  isNull(payments.sessionSettledAt),
) as SQL;

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
