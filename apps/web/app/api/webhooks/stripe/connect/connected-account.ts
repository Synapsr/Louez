import { eq } from "drizzle-orm";
import { after } from "next/server";
import Stripe from "stripe";

import { db, payments, reservations, stores } from "@louez/db";

import { type BillingAlerts, createBillingAlerts } from "@/lib/billing-sync/alerts";
import { log } from "@/lib/evlog";

// Whether Louez acts on a Connect event's account, decided from Louez's own
// rows alone, before any handler: an account no store holds and no payment
// recorded is not acted on, the route answers 2xx and Stripe is never asked.
// Nothing Stripe answers about an account makes the route acknowledge an
// event: once a handler runs, every failure answers 5xx, so Stripe sends the
// event again for as long as it retries, and an account connected again
// meanwhile resumes it. When the failure is Stripe saying the platform has no
// access to a known account, the platform is alerted
// (`alertIfAccountUnreachable`): Stripe retries such an event, then drops it,
// and the alert is what tells the platform.

/** The store a known account belongs to: the one holding it, else a recorded payment's. */
export async function connectedAccountOwner(
  accountId: string,
): Promise<{ readonly storeId: string } | null> {
  const [store] = await db
    .select({ storeId: stores.id })
    .from(stores)
    .where(eq(stores.stripeAccountId, accountId))
    .limit(1);
  if (store) return store;
  // A store that changed or dropped its account still owns that payment's
  // refunds and disputes.
  const [payment] = await db
    .select({ storeId: reservations.storeId })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .where(eq(payments.stripeAccountId, accountId))
    .limit(1);
  return payment ?? null;
}

/**
 * Whether Stripe said the platform has no access to the connected account (not,
 * or no longer, connected, or no such account): its code `account_invalid`,
 * on the error or on one it wraps (`cause`). A 403 without it is the
 * platform's own key lacking a permission (a restricted key).
 */
export function isAccountAccessRefused(error: unknown): boolean {
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Stripe.errors.StripeError && current.code === "account_invalid") {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

export type ConnectedAccountVerdict =
  | { readonly act: true; readonly owner: { readonly storeId: string } | null }
  | { readonly act: false };

/**
 * Whether the route runs the event's handler, from Louez's rows alone. An
 * event without an account goes to its handler, which says so itself.
 */
export async function connectedAccountVerdict(
  event: {
    readonly id: string;
    readonly type: string;
    readonly accountId: string | undefined;
  },
  owner: typeof connectedAccountOwner = connectedAccountOwner,
): Promise<ConnectedAccountVerdict> {
  const { id, type, accountId } = event;
  if (!accountId) return { act: true, owner: null };
  const known = await owner(accountId);
  if (!known) {
    log.warn({
      stripeWebhook: { event: type, issue: "account_unknown", stripeEventId: id, accountId },
    });
    return { act: false };
  }
  return { act: true, owner: known };
}

/**
 * After a handler failed, which the route answers 5xx: when Stripe said the
 * platform has no access to the event's known account, the platform is
 * alerted (an Evlog error each time, the admin Discord channel once an hour).
 * Never throws: the answer stays 5xx.
 */
export async function alertIfAccountUnreachable(
  event: {
    readonly id: string;
    readonly type: string;
    readonly accountId: string | undefined;
    readonly owner: { readonly storeId: string } | null;
  },
  error: unknown,
  alerts: () => BillingAlerts = () => createBillingAlerts({ schedule: after }),
): Promise<void> {
  const { id, type, accountId, owner } = event;
  if (!accountId || !owner || !isAccountAccessRefused(error)) return;
  try {
    await alerts().alert(
      "connected_account_unreachable",
      `Stripe answers that the platform has no access to the connected account ${accountId} of store ${owner.storeId}: its ${type} event ${id} failed. Stripe sends it again while it retries, then drops it; connect the account again to have it recorded.`,
    );
  } catch {
    // An alert that cannot be raised never changes the answer.
  }
}
