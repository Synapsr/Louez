import "server-only";

import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

import { env } from "@/env";
import { releaseNumberBinding } from "@/lib/ai/phone/number-release";
import { decryptIntegrationSecret } from "@/lib/integrations/credentials";
import {
  GoogleCalendarApiError,
  deleteGoogleCalendar,
  refreshGoogleCalendarAccessToken,
  revokeGoogleToken,
} from "@/lib/integrations/providers/google-calendar/google-calendar-client";
import {
  SuperPdpApiError,
  revokeSuperPdpToken,
} from "@/lib/integrations/providers/superpdp/superpdp-client";
import { tulipDeleteProduct } from "@/lib/integrations/tulip/client";
import { getStorageClient } from "@/lib/storage/files";
import { getStripe } from "@/lib/stripe/client";

import { deleteGleapUser, deleteOpenReplayUser, deletePostHogPerson } from "./analytics-erasure";
import type {
  AccountDeletionContext,
  AccountDeletionExternalResources,
  AccountDeletionExternalServices,
} from "./account-deletion";

const DELETE_OBJECT_BATCH_SIZE = 1_000;

const deleteStoragePrefix = async (prefix: string): Promise<void> => {
  const storage = getStorageClient();
  let continuationToken: string | undefined;

  do {
    const listed = await storage.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const keys = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => Boolean(key));

    for (let index = 0; index < keys.length; index += DELETE_OBJECT_BATCH_SIZE) {
      const batch = keys.slice(index, index + DELETE_OBJECT_BATCH_SIZE);
      const deleted = await storage.send(
        new DeleteObjectsCommand({
          Bucket: env.S3_BUCKET,
          Delete: {
            Objects: batch.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }),
      );
      if ((deleted.Errors?.length ?? 0) > 0) {
        throw new Error(`Failed to delete objects under storage prefix ${prefix}`);
      }
    }

    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    if (listed.IsTruncated && !continuationToken) {
      throw new Error(`Storage pagination failed for prefix ${prefix}`);
    }
  } while (continuationToken);
};

const getProviderErrorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null) return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : null;
};

const ignoreMissingStripeResource = async (operation: () => Promise<unknown>): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    if (getProviderErrorCode(error) === "resource_missing") return;
    throw error;
  }
};

interface StripeConnectCleanupAdapter {
  deleteAccount: (accountId: string) => Promise<unknown>;
  isLiveMode: boolean;
  retrieveAccount: (accountId: string) => Promise<{
    type: string;
    controller?: {
      losses?: {
        payments?: string;
      };
    };
  }>;
}

const createStripeConnectCleanupAdapter = (stripe = getStripe()): StripeConnectCleanupAdapter => ({
  deleteAccount: (accountId) => stripe.accounts.del(accountId),
  // Stripe's Account object does not expose the request mode. Unknown or
  // restricted-key prefixes are treated as live so Standard accounts fail closed.
  isLiveMode: !/^(?:sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? ""),
  retrieveAccount: async (accountId) => {
    const account = await stripe.accounts.retrieve(accountId);
    return {
      controller: account.controller,
      type: account.type,
    };
  },
});

export const cleanupStripeConnectedAccounts = async (
  accountIds: string[],
  adapter: StripeConnectCleanupAdapter = createStripeConnectCleanupAdapter(),
): Promise<void> => {
  const accountIdsToDelete: string[] = [];
  for (const accountId of accountIds) {
    let account;
    try {
      account = await adapter.retrieveAccount(accountId);
    } catch (error) {
      if (getProviderErrorCode(error) === "resource_missing") continue;
      throw error;
    }

    const stripeOwnsLossLiability =
      account.type === "standard" || account.controller?.losses?.payments === "stripe";
    if (adapter.isLiveMode && stripeOwnsLossLiability) {
      throw new Error(
        "The Stripe connected account must be disconnected from the Stripe Dashboard before account deletion",
      );
    }

    accountIdsToDelete.push(accountId);
  }

  for (const accountId of accountIdsToDelete) {
    await ignoreMissingStripeResource(() => adapter.deleteAccount(accountId));
  }
};

const cleanupStripeBilling = async (context: AccountDeletionContext): Promise<void> => {
  const { stripeAccountIds, stripeCustomerIds, stripeSubscriptionIds } = context.externalResources;
  if (
    stripeAccountIds.length === 0 &&
    stripeCustomerIds.length === 0 &&
    stripeSubscriptionIds.length === 0
  ) {
    return;
  }

  const stripe = getStripe();
  for (const subscriptionId of stripeSubscriptionIds) {
    await ignoreMissingStripeResource(() =>
      stripe.subscriptions.cancel(subscriptionId, {
        invoice_now: false,
        prorate: false,
      }),
    );
  }
  for (const customerId of stripeCustomerIds) {
    await ignoreMissingStripeResource(() => stripe.customers.del(customerId));
  }
  await cleanupStripeConnectedAccounts(stripeAccountIds, createStripeConnectCleanupAdapter(stripe));
};

const cleanupPhoneNumbers = async (context: AccountDeletionContext): Promise<void> => {
  for (const binding of context.externalResources.phoneNumberBindings) {
    const result = await releaseNumberBinding(binding);
    if (!result.ok) {
      throw new Error(`Failed to release phone number binding ${binding.id}`);
    }
  }
};

interface GoogleCleanupDependencies {
  decryptSecret: (encryptedValue: string) => string;
  deleteCalendar: typeof deleteGoogleCalendar;
  isCredentialUnavailableError: (error: unknown) => boolean;
  now: () => number;
  refreshAccessToken: typeof refreshGoogleCalendarAccessToken;
  revokeToken: typeof revokeGoogleToken;
}

const googleCleanupDependencies = {
  decryptSecret: decryptIntegrationSecret,
  deleteCalendar: deleteGoogleCalendar,
  isCredentialUnavailableError: (error: unknown) =>
    error instanceof GoogleCalendarApiError && (error.status === 400 || error.status === 401),
  now: Date.now,
  refreshAccessToken: refreshGoogleCalendarAccessToken,
  revokeToken: revokeGoogleToken,
} satisfies GoogleCleanupDependencies;

export const cleanupGoogleConnections = async (
  resources: Pick<
    AccountDeletionExternalResources,
    "googleAuthTokens" | "googleCalendarConnections"
  >,
  dependencies: GoogleCleanupDependencies = googleCleanupDependencies,
): Promise<void> => {
  for (const connection of resources.googleCalendarConnections) {
    const accessToken = connection.accessTokenEncrypted
      ? dependencies.decryptSecret(connection.accessTokenEncrypted)
      : null;
    const refreshToken = connection.refreshTokenEncrypted
      ? dependencies.decryptSecret(connection.refreshTokenEncrypted)
      : null;
    let usableAccessToken =
      accessToken &&
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() > dependencies.now() + 60_000
        ? accessToken
        : null;

    if (!usableAccessToken && refreshToken) {
      try {
        usableAccessToken = (await dependencies.refreshAccessToken(refreshToken)).accessToken;
      } catch (error) {
        if (!dependencies.isCredentialUnavailableError(error)) {
          throw error;
        }
      }
    }

    if (connection.calendarId && usableAccessToken) {
      await dependencies.deleteCalendar({
        accessToken: usableAccessToken,
        calendarId: connection.calendarId,
      });
    } else if (connection.calendarId) {
      throw new Error(
        "Known Google Calendar could not be deleted because no usable credential remains",
      );
    }

    for (const token of [refreshToken, accessToken].filter((value): value is string =>
      Boolean(value),
    )) {
      await dependencies.revokeToken(token);
    }
  }

  for (const token of resources.googleAuthTokens) {
    await dependencies.revokeToken(token);
  }
};

const cleanupSuperPdp = async (context: AccountDeletionContext): Promise<void> => {
  for (const encryptedToken of context.externalResources.superPdpTokensEncrypted) {
    try {
      await revokeSuperPdpToken(decryptIntegrationSecret(encryptedToken));
    } catch (error) {
      if (error instanceof SuperPdpApiError && (error.status === 400 || error.status === 404)) {
        continue;
      }
      throw error;
    }
  }
};

const cleanupTulip = async (context: AccountDeletionContext): Promise<void> => {
  const { tulipProductIds } = context.externalResources;
  if (tulipProductIds.length === 0) return;
  if (!env.TULIP_API_KEY) {
    throw new Error("TULIP_API_KEY is required to delete linked Tulip products");
  }

  for (const productId of tulipProductIds) {
    await tulipDeleteProduct(env.TULIP_API_KEY, productId);
  }
};

const cleanupAnalytics = async (context: AccountDeletionContext): Promise<void> => {
  if (env.NEXT_PUBLIC_POSTHOG_KEY) {
    if (!env.POSTHOG_PROJECT_ID || !env.POSTHOG_PERSONAL_API_KEY) {
      throw new Error(
        "POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY are required for account deletion",
      );
    }
    await deletePostHogPerson({
      apiHost: env.POSTHOG_API_HOST,
      personalApiKey: env.POSTHOG_PERSONAL_API_KEY,
      projectId: env.POSTHOG_PROJECT_ID,
      distinctId: context.user.id,
    });
  }

  if (env.NEXT_PUBLIC_GLEAP_API_KEY) {
    if (!env.GLEAP_API_TOKEN) {
      throw new Error("GLEAP_API_TOKEN is required for account deletion");
    }
    await deleteGleapUser({
      apiToken: env.GLEAP_API_TOKEN,
      userId: context.user.id,
    });
  }

  if (env.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY) {
    if (!env.OPENREPLAY_API_URL || !env.OPENREPLAY_ORGANIZATION_API_KEY) {
      throw new Error(
        "OPENREPLAY_API_URL and OPENREPLAY_ORGANIZATION_API_KEY are required for account deletion",
      );
    }
    await deleteOpenReplayUser({
      apiUrl: env.OPENREPLAY_API_URL,
      organizationApiKey: env.OPENREPLAY_ORGANIZATION_API_KEY,
      projectKey: env.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY,
      userId: context.user.email,
    });
  }
};

export const assertAccountDeletionExternalConfiguration = (
  context?: AccountDeletionContext,
): void => {
  if (env.NEXT_PUBLIC_POSTHOG_KEY && (!env.POSTHOG_PROJECT_ID || !env.POSTHOG_PERSONAL_API_KEY)) {
    throw new Error("PostHog erasure credentials are not configured");
  }
  if (env.NEXT_PUBLIC_GLEAP_API_KEY && !env.GLEAP_API_TOKEN) {
    throw new Error("Gleap erasure credentials are not configured");
  }
  if (
    env.NEXT_PUBLIC_OPENREPLAY_PROJECT_KEY &&
    (!env.OPENREPLAY_API_URL || !env.OPENREPLAY_ORGANIZATION_API_KEY)
  ) {
    throw new Error("OpenReplay erasure credentials are not configured");
  }

  if (!context) return;

  const resources = context.externalResources;
  if (
    (resources.stripeAccountIds.length > 0 ||
      resources.stripeCustomerIds.length > 0 ||
      resources.stripeSubscriptionIds.length > 0) &&
    !env.STRIPE_SECRET_KEY
  ) {
    throw new Error("Stripe erasure credentials are not configured");
  }
  if (resources.tulipProductIds.length > 0 && !env.TULIP_API_KEY) {
    throw new Error("Tulip erasure credentials are not configured");
  }
  if (
    resources.phoneNumberBindings.some((binding) => Boolean(binding.providerNumberId)) &&
    (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN)
  ) {
    throw new Error("Twilio erasure credentials are not configured");
  }

  const hasEncryptedIntegrationCredentials =
    resources.googleCalendarConnections.some(
      (connection) =>
        Boolean(connection.accessTokenEncrypted) || Boolean(connection.refreshTokenEncrypted),
    ) || resources.superPdpTokensEncrypted.length > 0;
  if (hasEncryptedIntegrationCredentials && !env.INTEGRATION_ENCRYPTION_KEY) {
    throw new Error("Integration credential decryption is not configured");
  }
  if (
    resources.googleCalendarConnections.length > 0 &&
    (!env.GOOGLE_CALENDAR_CLIENT_ID || !env.GOOGLE_CALENDAR_CLIENT_SECRET)
  ) {
    throw new Error("Google Calendar erasure credentials are not configured");
  }
  if (
    resources.superPdpTokensEncrypted.length > 0 &&
    (!env.SUPERPDP_CLIENT_ID || !env.SUPERPDP_CLIENT_SECRET)
  ) {
    throw new Error("SuperPDP erasure credentials are not configured");
  }
};

const cleanup = async (context: AccountDeletionContext): Promise<void> => {
  assertAccountDeletionExternalConfiguration(context);
  await cleanupGoogleConnections(context.externalResources);
  await cleanupSuperPdp(context);
  await cleanupTulip(context);
  for (const prefix of context.externalResources.storagePrefixes) {
    await deleteStoragePrefix(prefix);
  }
  await cleanupPhoneNumbers(context);
  await cleanupStripeBilling(context);
  await cleanupAnalytics(context);
};

export const accountDeletionExternalServices: AccountDeletionExternalServices = {
  cleanup,
};
