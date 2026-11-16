import { eq } from "drizzle-orm";
import Stripe from "stripe";

import { db, payments, stores } from "@louez/db";

import { log } from "@/lib/evlog";

// A Connect event Louez cannot act on is acknowledged, not failed: when its
// account is unknown to Louez, or Stripe refuses the platform any access to
// that account, the route answers 2xx, writes nothing and logs one line, so
// Stripe stops sending it. A failure that may pass (the network, a rate limit,
// Stripe's own 5xx, the database) still throws, and the route answers 5xx so
// Stripe delivers the event again.

/**
 * Whether Louez knows the account: a store holds it now, or a payment recorded
 * it (a store that changed or dropped its account still owns that payment's
 * refunds and disputes).
 */
export async function isKnownConnectedAccount(accountId: string): Promise<boolean> {
  const [store] = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.stripeAccountId, accountId))
    .limit(1);
  if (store) return true;
  const [payment] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.stripeAccountId, accountId))
    .limit(1);
  return Boolean(payment);
}

/**
 * Whether Stripe refused the platform any access to the connected account, an
 * answer no retry changes: a `StripePermissionError` (HTTP 403: the account is
 * not, or no longer, connected to the platform, or does not exist), or any
 * Stripe error with the code `account_invalid`, Stripe's code for that
 * refusal. Not the platform's own key refused (`StripeAuthenticationError`,
 * 401), a rate limit (`StripeRateLimitError`, 429), the network
 * (`StripeConnectionError`), Stripe's own failure (`StripeAPIError`), nor any
 * other request Stripe refused: those may pass, and Stripe sends the event
 * again.
 */
export function isAccountAccessRefused(error: unknown): error is Stripe.errors.StripeError {
  return (
    error instanceof Stripe.errors.StripePermissionError ||
    (error instanceof Stripe.errors.StripeError && error.code === "account_invalid")
  );
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
  isKnown: (accountId: string) => Promise<boolean> = isKnownConnectedAccount,
): Promise<"handled" | "account_unknown" | "account_access_refused"> {
  const { type, accountId } = event;
  if (accountId && !(await isKnown(accountId))) {
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
        ...describeWebhookError(error),
      },
    });
    return "account_access_refused";
  }
}
