import {
  setSessionHook,
  setUserCreatedHook,
  setUserDeleteHook,
  setUserDeleteRequestHook,
} from '@louez/auth';
import { db } from '@louez/db';

import { deleteAccountData } from '@/lib/account-deletion/account-deletion';
import { accountDeletionRepository } from '@/lib/account-deletion/database-repository';
import {
  accountDeletionExternalServices,
  assertAccountDeletionExternalConfiguration,
} from '@/lib/account-deletion/external-services';
import { env } from '@/env';
import { notifyUserSignedIn } from '@/lib/discord/platform-notifications';
import { log } from '@/lib/evlog';
import { captureProductServerEvent } from '@/lib/product-analytics/analytics';
import {
  authenticationAnalyticsBaseProperties,
  productAnalyticsEvents,
} from '@/lib/product-analytics/analytics-events';

// Re-export auth() and authInstance from the package
// All 17+ consumer files import { auth } from '@/lib/auth' — zero changes needed
export { auth, authInstance } from '@louez/auth';

setUserCreatedHook(async ({ userId }) => {
  await captureProductServerEvent({
    distinctId: userId,
    event: productAnalyticsEvents.accountCreated,
    properties: {
      ...authenticationAnalyticsBaseProperties,
      source: 'auth_database_hook',
    },
  });
});

setUserDeleteRequestHook(async ({ userId }) => {
  const context = await accountDeletionRepository.getContext(userId);
  if (!context) {
    throw new Error('Account not found');
  }
  assertAccountDeletionExternalConfiguration(context);
  if (
    context.stores.some((store) => store.legalRecordCount > 0) &&
    !env.LEGAL_ARCHIVE_ENCRYPTION_KEY
  ) {
    throw new Error('Legal archive encryption is not configured');
  }
});

setUserDeleteHook(async ({ userId, reason }) => {
  const result = await deleteAccountData({
    userId,
    ...(reason ? { reason } : {}),
    repository: accountDeletionRepository,
    externalServices: accountDeletionExternalServices,
  });

  if (result.status === 'blocked') {
    return { status: 'blocked', reason: result.reason };
  }

  log.info({
    accountDeletion: {
      storesDeleted: result.storesDeleted,
      legalRecordsRetained: result.legalRecordsRetained,
    },
  });
  return { status: 'deleted' };
});

// Wire Discord notifications for session creation
setSessionHook(async (session) => {
  const user = await db.query.users.findFirst({
    where: (users, { eq }) => eq(users.id, session.userId),
  });
  if (user) {
    const account = await db.query.accounts.findFirst({
      where: (accounts, { eq, and }) =>
        and(
          eq(accounts.userId, session.userId),
          eq(accounts.providerId, 'google'),
        ),
    });
    const method = account ? 'google' : 'magic link';
    notifyUserSignedIn(session.userId, user.email, method).catch(() => {});
  }
});
