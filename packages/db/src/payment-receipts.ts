import { sql } from "drizzle-orm";

import type { SQL, SQLWrapper } from "drizzle-orm";
import { payments } from "./schema";

/** The three ids of a `payments` row, or of an alias of it in a self-join. */
interface StripeRefundColumns {
  stripeRefundId: SQLWrapper;
  stripePaymentIntentId: SQLWrapper;
  stripeCheckoutSessionId: SQLWrapper;
}

/**
 * A Stripe refund is stored as its own positive row: it carries the refund id
 * and none of the ids a charge is created with. The refund id alone does not
 * identify it, because older webhooks also stamped it on the refunded charge
 * row, which keeps its payment intent or checkout session.
 *
 * The refunded charge row is already brought down to its net amount, so a
 * Stripe refund row is neither money received nor money to subtract again.
 */
export function isStripeRefundPaymentSql(row: StripeRefundColumns = payments): SQL<boolean> {
  return sql<boolean>`(
    ${row.stripeRefundId} IS NOT NULL
    AND ${row.stripePaymentIntentId} IS NULL
    AND ${row.stripeCheckoutSessionId} IS NULL
  )`;
}

/**
 * Money received: never a row that gives money back, whether a manual refund
 * (it points at the row it refunds) or a Stripe refund.
 */
export function isPaymentReceiptSql(): SQL<boolean> {
  return sql<boolean>`(
    ${payments.refundOfPaymentId} IS NULL
    AND NOT ${isStripeRefundPaymentSql()}
  )`;
}
