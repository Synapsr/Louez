import { setSessionHook } from '@louez/auth';
import { db } from '@louez/db';

import {
  notifyUserSignedIn,
} from '@/lib/discord/platform-notifications';

// Re-export auth() and authInstance from the package
// All 17+ consumer files import { auth } from '@/lib/auth' — zero changes needed
export { auth, authInstance } from '@louez/auth';

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
