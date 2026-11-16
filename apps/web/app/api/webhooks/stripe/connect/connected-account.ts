import { eq } from "drizzle-orm";
import Stripe from "stripe";

import { after } from "next/server";

import { db, payments, reservations, stores } from "@louez/db";

import { type BillingAlerts, createBillingAlerts } from "@/lib/billing-sync/alerts";
import { log } from "@/lib/evlog";

// A Connect event Louez cannot act on is acknowledged, not failed: when its
// account is unknown to Louez, or Stripe answers that the platform has no
// access to that account (`account_invalid`), the route answers 2xx, writes
// nothing and logs one line, so Stripe stops sending it; for an account Louez
// knows, the platform is alerted too. A failure that may pass (the network, a rate limit,
// Stripe's own 5xx, the database) still throws, and the route answers 5xx so
// Stripe delivers the event again.

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
 * Whether Stripe says the platform has no access to the connected account
 * (not, or no longer, connected, or no such account): its code
 * `account_invalid`, the one answer no retry changes. Any other Stripe error is
 * not: a 403 without it is the platform's own key lacking a permission (a
 * restricted key), which a fix of the key settings passes, and a 401, a 429,
 * the network or Stripe's 5xx may pass by themselves.
 */
export function isAccountAccessRefused(error: unknown): error is Stripe.errors.StripeError {
  return error instanceof Stripe.errors.StripeError && error.code === "account_invalid";
}

/**
 * What a log may say of an error. Of a Stripe error, its class, code, status
 * and request id, never its message: Stripe writes the platform key's masked
 * tail into some of them. Of any other, its message.
 */
export function describeWebhookError(error: unknown): Record<string, unknown> {
  if (error instanceof Stripe.errors.StripeError) {
    return {
      stripeError: {
        type: error.type,
        code: error.code ?? null,
        statusCode: error.statusCode ?? null,
        requestId: error.requestId ?? null,
      },
    };
  }
  return { error: error instanceof Error ? error.message : String(error) };
}

/**
 * Runs the handler of an event read on a connected account, when Louez can act
 * on it: an event whose account Louez does not know is not handled, and one
 * whose account Stripe refuses the platform is given up. Each is logged once,
 * with the event's type and why, and answered 2xx. Every handler it runs
 * reads Stripe before it writes, so a refusal leaves nothing written. Any
 * other error is thrown, for the route to answer 5xx. An event without an
 * account goes to its handler, which says so itself.
 */
export async function onConnectedAccount(
  event: { readonly type: string; readonly accountId: string | undefined },
  handle: () => Promise<unknown>,
  deps: {
    owner: typeof connectedAccountOwner;
    alerts: () => BillingAlerts;
  } = { owner: connectedAccountOwner, alerts: () => createBillingAlerts({ schedule: after }) },
): Promise<"handled" | "account_unknown" | "account_access_refused"> {
  const { type, accountId } = event;
  const owner = accountId ? await deps.owner(accountId) : null;
  if (accountId && !owner) {
    log.warn({ stripeWebhook: { event: type, issue: "account_unknown", accountId } });
    return "account_unknown";
  }
  try {
    await handle();
    return "handled";
  } catch (error) {
    if (!isAccountAccessRefused(error)) throw error;
    log.warn({
      stripeWebhook: {
        event: type,
        issue: "account_access_refused",
        accountId,
        storeId: owner?.storeId ?? null,
        ...describeWebhookError(error),
      },
    });
    // A store whose account the platform lost while Louez holds its payments:
    // refunds and disputes there go unrecorded until someone reconnects it.
    await deps
      .alerts()
      .alert(
        "connected_account_unreachable",
        `Stripe refuses the platform the connected account ${accountId} of store ${owner?.storeId}: its ${type} event is acknowledged without being recorded.`,
      );
    return "account_access_refused";
  }
}
