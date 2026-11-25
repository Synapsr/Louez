import { db, markStore, stores, users } from "@louez/db";
import { and, eq, isNull } from "drizzle-orm";

import {
  connectAccountParams,
  createOnboardingLink,
  getAccountStatus,
  type ConnectAccountStatus,
  type StripeConnectClient,
} from "../adapters/stripe-connect";
import { analyticsEventIdentity, enqueueEffects } from "../platform/effects";
import { apiError, isApiError } from "../platform/errors";
import { logProviderError } from "../platform/sanitize-error";
import type { ApiPorts, UrlsPort } from "../platform/ports";

/**
 * Stripe Connect for a store: open its connected account, send the user to
 * Stripe's hosted onboarding, read the account back. The dashboard's payment
 * settings, the agent's handoffs and their return pages share it; the
 * `account.updated` webhook writes the same columns from Stripe's event.
 */

/** What these flows read of the store row. */
export interface ConnectStore {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  settings: { country?: string | null } | null;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean | null;
}

export const stripeConnectErrors = {
  notConfigured: () =>
    apiError("CONFLICT", "STRIPE_NOT_CONFIGURED", {
      message: "This Louez instance has no Stripe set up, so stores cannot take online payments.",
      i18nKey: "errors.stripeNotConfigured",
    }),
  alreadyConnected: () =>
    apiError("CONFLICT", "STRIPE_ALREADY_CONNECTED", {
      message:
        "The store's Stripe account already takes payments. Read payments_sync_stripe_status for its state.",
      i18nKey: "errors.stripe.alreadyConnected",
    }),
  emailRequired: () =>
    apiError("CONFLICT", "STORE_EMAIL_REQUIRED", {
      message:
        "Stripe needs an email for the account: set the store's contact email (settings_update_store_info) first.",
      i18nKey: "errors.email",
    }),
  noAccount: () =>
    apiError("CONFLICT", "NO_STRIPE_ACCOUNT", {
      message:
        "The store has no Stripe account yet. Start one with payments_start_stripe_onboarding.",
      i18nKey: "errors.noStripeAccount",
    }),
  paymentNotInStripe: () =>
    apiError("CONFLICT", "PAYMENT_NOT_IN_STRIPE", {
      message:
        "This payment was not taken through Stripe, or Stripe has no payment for it yet: there is nothing to open there.",
    }),
  unavailable: (i18nKey: string) =>
    apiError("INTERNAL_SERVER_ERROR", "STRIPE_UNAVAILABLE", {
      message: "Stripe did not answer as expected. Try again in a moment.",
      i18nKey,
      retryable: true,
    }),
};

/** The configured client, or STRIPE_NOT_CONFIGURED. */
export function requireConnectClient(ports: Pick<ApiPorts, "stripeConnect">): StripeConnectClient {
  const client = ports.stripeConnect?.() ?? null;
  if (!client) throw stripeConnectErrors.notConfigured();
  return client;
}

/** The store's Connect columns, which are in its billing snapshot. */
export type ConnectColumns = Partial<
  Pick<
    typeof stores.$inferInsert,
    "stripeAccountId" | "stripeChargesEnabled" | "stripeOnboardingComplete"
  >
>;

/**
 * Writes the store's Connect columns and marks its billing snapshot. The
 * first write that finds charges enabled, from the webhook or a status sync,
 * marks the store's Connect as completed and queues `stripe_connect_completed`
 * in the same transaction: once per store, whatever writes after it (a
 * redelivered event, an account disabled then enabled again, a new account).
 * Answers the ids of the rows it queued, for `ports.dispatchEffects`.
 */
export async function writeConnectColumns(
  storeId: string,
  values: ConnectColumns,
): Promise<string[]> {
  return db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(stores)
      .set({ ...values, updatedAt: now })
      .where(eq(stores.id, storeId));
    await markStore(tx, storeId);
    if (values.stripeChargesEnabled !== true) return [];

    const [marked] = await tx
      .update(stores)
      .set({ stripeConnectCompletedAt: now })
      .where(and(eq(stores.id, storeId), isNull(stores.stripeConnectCompletedAt)));
    if (marked.affectedRows !== 1) return [];
    const store = await tx.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: { userId: true, createdAt: true },
    });
    if (!store) return [];
    return enqueueEffects(tx, storeId, [
      {
        type: "store.lifecycleAnalytics",
        payload: {
          ...analyticsEventIdentity(now),
          event: "stripe_connect_completed",
          ownerUserId: store.userId,
          properties: {
            details_submitted: values.stripeOnboardingComplete === true,
            seconds_since_store_created: Math.max(
              0,
              Math.round((now.getTime() - store.createdAt.getTime()) / 1000),
            ),
          },
        },
      },
    ]);
  });
}

const columnsOf = (status: ConnectAccountStatus): ConnectColumns => ({
  stripeChargesEnabled: status.chargesEnabled,
  stripeOnboardingComplete: status.chargesEnabled && status.detailsSubmitted,
});

/**
 * The account to onboard: the store's own while it is not chargeable yet,
 * or a new one. A Stripe account's country cannot change: a pending account
 * opened for another country is left behind, as its identity checks target
 * the wrong country anyway.
 */
async function accountToOnboard(
  client: StripeConnectClient,
  store: ConnectStore,
  urls: UrlsPort,
): Promise<string> {
  if (store.stripeAccountId && store.stripeChargesEnabled) {
    throw stripeConnectErrors.alreadyConnected();
  }
  const country = (store.settings?.country || "FR").toUpperCase();
  if (store.stripeAccountId) {
    const status = await getAccountStatus(client, store.stripeAccountId);
    if (!status.country || status.country.toUpperCase() === country) return store.stripeAccountId;
  }

  const owner = await db.query.users.findFirst({
    where: eq(users.id, store.userId),
    columns: { email: true },
  });
  const email = (store.email || owner?.email || "").trim();
  if (!email) throw stripeConnectErrors.emailRequired();

  const account = await client.accounts.create(
    connectAccountParams({
      store: {
        id: store.id,
        name: store.name,
        description: store.description,
        phone: store.phone,
        storefrontUrl: urls.storefront(store.slug, "/"),
      },
      email,
      country,
    }),
  );
  await writeConnectColumns(store.id, { stripeAccountId: account.id });
  return account.id;
}

/**
 * Opens the store's connected account if it needs one, and returns a hosted
 * onboarding link that comes back to `returnUrl` (or `refreshUrl` when the
 * link expired). Stripe's failures answer STRIPE_UNAVAILABLE.
 */
export async function startConnectOnboarding(input: {
  client: StripeConnectClient;
  store: ConnectStore;
  urls: UrlsPort;
  returnUrl: string;
  refreshUrl: string;
}): Promise<{ url: string; accountId: string }> {
  try {
    const accountId = await accountToOnboard(input.client, input.store, input.urls);
    const url = await createOnboardingLink(input.client, accountId, {
      returnUrl: input.returnUrl,
      refreshUrl: input.refreshUrl,
    });
    return { url, accountId };
  } catch (error) {
    if (isConnectError(error)) throw error;
    logProviderError("Stripe onboarding failed", error);
    throw stripeConnectErrors.unavailable("errors.stripe.onboardingFailed");
  }
}

/**
 * Reads the account from Stripe and writes what the store keeps of it:
 * charges enabled, onboarding complete. Payment mode follows by itself
 * (ADR 0004): the storefront takes payments once charges are enabled.
 */
export async function syncConnectStatus(input: {
  client: StripeConnectClient;
  storeId: string;
  accountId: string | null;
}): Promise<ConnectAccountStatus> {
  if (!input.accountId) throw stripeConnectErrors.noAccount();
  let status: ConnectAccountStatus;
  try {
    status = await getAccountStatus(input.client, input.accountId);
  } catch (error) {
    logProviderError("Stripe status sync failed", error);
    throw stripeConnectErrors.unavailable("errors.stripe.syncFailed");
  }
  await writeConnectColumns(input.storeId, columnsOf(status));
  return status;
}

const CONNECT_CODES = new Set([
  "STRIPE_NOT_CONFIGURED",
  "STRIPE_ALREADY_CONNECTED",
  "STORE_EMAIL_REQUIRED",
  "NO_STRIPE_ACCOUNT",
  "STRIPE_UNAVAILABLE",
]);

const isConnectError = (error: unknown): boolean =>
  isApiError(error) && CONNECT_CODES.has(error.data.code);
