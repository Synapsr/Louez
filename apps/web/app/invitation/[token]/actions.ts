'use server'

import { auth } from '@/lib/auth'
import { db } from '@louez/db'
import { storeInvitations, storeMembers, users } from '@louez/db'
import { eq, and } from 'drizzle-orm'
import { setActiveStoreId } from '@/lib/store-context'

export async function acceptInvitation(token: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'Vous devez être connecté pour accepter cette invitation' }
  }

  // Find the invitation
  const invitation = await db.query.storeInvitations.findFirst({
    where: and(
      eq(storeInvitations.token, token),
      eq(storeInvitations.status, 'pending')
    ),
  })

  if (!invitation) {
    return { error: 'Cette invitation n\'est plus valide' }
  }

  // Check if expired
  if (new Date() > new Date(invitation.expiresAt)) {
    return { error: 'Cette invitation a expiré' }
  }

  // Get user email
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })

  if (!user) {
    return { error: 'Utilisateur non trouvé' }
  }

  // Check email match
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return { error: 'Cette invitation est destinée à une autre adresse email' }
  }

  // Check if already a member
  const existingMember = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, invitation.storeId),
      eq(storeMembers.userId, session.user.id)
    ),
  })

  if (existingMember) {
    return { error: 'Vous êtes déjà membre de cette boutique' }
  }

  // Add as member
  await db.insert(storeMembers).values({
    storeId: invitation.storeId,
    userId: session.user.id,
    role: invitation.role,
    addedBy: invitation.invitedBy,
  })

  // Mark invitation as accepted
  await db
    .update(storeInvitations)
    .set({
      status: 'accepted',
      acceptedAt: new Date(),
    })
    .where(eq(storeInvitations.id, invitation.id))

  // Set as active store (will succeed since we just added membership above)
  const setStoreResult = await setActiveStoreId(invitation.storeId)
  if (!setStoreResult.success) {
    // This should not happen since we just added the membership
    console.error('[SECURITY] Failed to set active store after accepting invitation:', setStoreResult.error)
  }

  return { success: true }
}
