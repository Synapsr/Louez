import { eq } from "drizzle-orm";
import { after } from "next/server";
import Stripe from "stripe";

import { db, payments, reservations, stores } from "@louez/db";

import { type BillingAlerts, createBillingAlerts } from "@/lib/billing-sync/alerts";
import { log } from "@/lib/evlog";
import { stripe } from "@/lib/stripe/client";

// Whether Louez may act on a Connect event's account, decided before its
// handler runs, from reads that change nothing. An account no store holds and
// no payment recorded is not acted on. For an event whose handler reads the
// account at Stripe, the account is read first (`GET /v1/account` on it):
// when Stripe answers that the platform has no access to it, the event is not
// acted on either, and the platform is alerted. Either way the route answers
// 2xx and Stripe stops sending the event. Any other failure of those reads
// throws, and the route answers 5xx. Once the handler runs, nothing here
// catches its failures: an event a handler has started on is delivered again.

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

export type ConnectedAccountVerdict =
  | { readonly act: true }
  | { readonly act: false; readonly issue: "account_unknown" | "account_access_refused" };

export interface ConnectedAccountDeps {
  owner: (accountId: string) => Promise<{ readonly storeId: string } | null>;
  /** Reads the account at Stripe, on the account, and changes nothing. */
  probe: (accountId: string) => Promise<unknown>;
  alerts: () => BillingAlerts;
}

const defaultDeps: ConnectedAccountDeps = {
  owner: connectedAccountOwner,
  probe: (accountId) => stripe.accounts.retrieveCurrent({}, { stripeAccount: accountId }),
  alerts: () => createBillingAlerts({ schedule: after }),
};

/**
 * Whether the route may run the event's handler. `readsAccount`: the handler
 * reads the account at Stripe, so Stripe's access to it is read first. An
 * event without an account goes to its handler, which says so itself.
 */
export async function connectedAccountVerdict(
  event: { readonly type: string; readonly accountId: string | undefined },
  readsAccount: boolean,
  deps: ConnectedAccountDeps = defaultDeps,
): Promise<ConnectedAccountVerdict> {
  const { type, accountId } = event;
  if (!accountId) return { act: true };
  const owner = await deps.owner(accountId);
  if (!owner) {
    log.warn({ stripeWebhook: { event: type, issue: "account_unknown", accountId } });
    return { act: false, issue: "account_unknown" };
  }
  if (!readsAccount) return { act: true };
  try {
    await deps.probe(accountId);
  } catch (error) {
    if (!isAccountAccessRefused(error)) throw error;
    log.warn({
      stripeWebhook: {
        event: type,
        issue: "account_access_refused",
        accountId,
        storeId: owner.storeId,
        ...describeWebhookError(error),
      },
    });
    // A store whose account the platform lost while Louez holds its payments:
    // refunds and disputes there go unrecorded until someone reconnects it.
    await deps
      .alerts()
      .alert(
        "connected_account_unreachable",
        `Stripe refuses the platform the connected account ${accountId} of store ${owner.storeId}: its ${type} event is acknowledged without being recorded.`,
      );
    return { act: false, issue: "account_access_refused" };
  }
  return { act: true };
}
