'use server';

import { and, eq } from 'drizzle-orm';

import { db } from '@louez/db';
import { storeInvitations, storeMembers, users } from '@louez/db';

import { auth } from '@/lib/auth';
import { setActiveStoreId } from '@/lib/store-context';

export async function acceptInvitation(token: string, name?: string) {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' };
  }

  const invitation = await db.query.storeInvitations.findFirst({
    where: and(
      eq(storeInvitations.token, token),
      eq(storeInvitations.status, 'pending'),
    ),
  });

  if (!invitation) {
    return { error: 'errors.invalid' };
  }

  if (new Date() > new Date(invitation.expiresAt)) {
    return { error: 'errors.expired' };
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  });

  if (!user) {
    return { error: 'errors.unauthorized' };
  }

  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return { error: 'errors.emailMismatch' };
  }

  const existingMember = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, invitation.storeId),
      eq(storeMembers.userId, session.user.id),
    ),
  });

  if (existingMember) {
    return { error: 'errors.alreadyMember' };
  }

  // Update user name if provided and not already set, and record that this
  // user reached Louez through an invitation (unless a channel is already known)
  const trimmedName = name?.trim();
  const userUpdates = {
    ...(trimmedName && !user.name ? { name: trimmedName } : {}),
    ...(user.acquisitionChannel ? {} : { acquisitionChannel: 'invitation' }),
  };
  if (Object.keys(userUpdates).length > 0) {
    await db
      .update(users)
      .set(userUpdates)
      .where(eq(users.id, session.user.id));
  }

  await db.insert(storeMembers).values({
    storeId: invitation.storeId,
    userId: session.user.id,
    role: invitation.role,
    addedBy: invitation.invitedBy,
  });

  await db
    .update(storeInvitations)
    .set({
      status: 'accepted',
      acceptedAt: new Date(),
    })
    .where(eq(storeInvitations.id, invitation.id));

  const setStoreResult = await setActiveStoreId(invitation.storeId);
  if (!setStoreResult.success) {
    console.error(
      '[SECURITY] Failed to set active store after accepting invitation:',
      setStoreResult.error,
    );
  }

  return { success: true };
}
