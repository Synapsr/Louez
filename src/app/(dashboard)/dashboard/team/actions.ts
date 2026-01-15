'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, storeMembers, storeInvitations } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { getCurrentStore, currentUserHasPermission } from '@/lib/store-context'
import { nanoid } from 'nanoid'
import { sendTeamInvitationEmail } from '@/lib/email/send'
import { z } from 'zod'
import { canAddTeamMember } from '@/lib/plan-limits'

const addMemberSchema = z.object({
  email: z.string().email(),
})

export async function addTeamMember(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' }
  }

  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.storeNotFound' }
  }

  // Check permission
  const canManage = await currentUserHasPermission('manage_members')
  if (!canManage) {
    return { error: 'errors.unauthorized' }
  }

  // Check plan limits
  const teamLimits = await canAddTeamMember(store.id)
  if (!teamLimits.allowed) {
    return { error: 'dashboard.team.limitReached' }
  }

  const validated = addMemberSchema.safeParse({
    email: formData.get('email'),
  })

  if (!validated.success) {
    return { error: 'errors.invalidEmail' }
  }

  const email = validated.data.email.toLowerCase()

  // Check if user already exists
  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, email),
  })

  if (existingUser) {
    // Check if already a member
    const existingMember = await db.query.storeMembers.findFirst({
      where: and(
        eq(storeMembers.storeId, store.id),
        eq(storeMembers.userId, existingUser.id)
      ),
    })

    if (existingMember) {
      return { error: 'dashboard.team.alreadyMember' }
    }

    // Add as member directly
    await db.insert(storeMembers).values({
      storeId: store.id,
      userId: existingUser.id,
      role: 'member',
      addedBy: session.user.id,
    })

    revalidatePath('/dashboard/team')
    return { success: true, type: 'added' }
  }

  // User doesn't exist, check for existing pending invitation
  const existingInvitation = await db.query.storeInvitations.findFirst({
    where: and(
      eq(storeInvitations.storeId, store.id),
      eq(storeInvitations.email, email),
      eq(storeInvitations.status, 'pending')
    ),
  })

  if (existingInvitation) {
    return { error: 'dashboard.team.invitationAlreadySent' }
  }

  // Create invitation
  const token = nanoid(32)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiry

  await db.insert(storeInvitations).values({
    storeId: store.id,
    email,
    role: 'member',
    token,
    invitedBy: session.user.id,
    expiresAt,
  })

  // Send invitation email
  try {
    const inviter = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    })

    await sendTeamInvitationEmail({
      to: email,
      storeName: store.name,
      storeLogoUrl: store.logoUrl,
      inviterName: inviter?.name || inviter?.email || 'Un membre',
      invitationUrl: `${process.env.NEXT_PUBLIC_APP_URL}/invitation/${token}`,
      locale: 'fr',
    })
  } catch (error) {
    console.error('Failed to send invitation email:', error)
    // Don't fail the action if email fails
  }

  revalidatePath('/dashboard/team')
  return { success: true, type: 'invited' }
}

export async function removeMember(memberId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' }
  }

  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.storeNotFound' }
  }

  const canManage = await currentUserHasPermission('manage_members')
  if (!canManage) {
    return { error: 'errors.unauthorized' }
  }

  // Get the member to remove
  const member = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.id, memberId),
      eq(storeMembers.storeId, store.id)
    ),
  })

  if (!member) {
    return { error: 'errors.memberNotFound' }
  }

  // Cannot remove self
  if (member.userId === session.user.id) {
    return { error: 'dashboard.team.cannotRemoveSelf' }
  }

  // Cannot remove owner
  if (member.role === 'owner') {
    return { error: 'dashboard.team.cannotRemoveOwner' }
  }

  await db.delete(storeMembers).where(eq(storeMembers.id, memberId))

  revalidatePath('/dashboard/team')
  return { success: true }
}

export async function cancelInvitation(invitationId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' }
  }

  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.storeNotFound' }
  }

  const canManage = await currentUserHasPermission('manage_members')
  if (!canManage) {
    return { error: 'errors.unauthorized' }
  }

  await db
    .update(storeInvitations)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(storeInvitations.id, invitationId),
        eq(storeInvitations.storeId, store.id)
      )
    )

  revalidatePath('/dashboard/team')
  return { success: true }
}

export async function resendInvitation(invitationId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthorized' }
  }

  const store = await getCurrentStore()
  if (!store) {
    return { error: 'errors.storeNotFound' }
  }

  const canManage = await currentUserHasPermission('manage_members')
  if (!canManage) {
    return { error: 'errors.unauthorized' }
  }

  const invitation = await db.query.storeInvitations.findFirst({
    where: and(
      eq(storeInvitations.id, invitationId),
      eq(storeInvitations.storeId, store.id)
    ),
  })

  if (!invitation || invitation.status !== 'pending') {
    return { error: 'errors.invitationNotFound' }
  }

  // Update expiry and generate new token
  const newToken = nanoid(32)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  await db
    .update(storeInvitations)
    .set({ token: newToken, expiresAt })
    .where(eq(storeInvitations.id, invitationId))

  // Resend email
  try {
    const inviter = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
    })

    await sendTeamInvitationEmail({
      to: invitation.email,
      storeName: store.name,
      storeLogoUrl: store.logoUrl,
      inviterName: inviter?.name || inviter?.email || 'Un membre',
      invitationUrl: `${process.env.NEXT_PUBLIC_APP_URL}/invitation/${newToken}`,
      locale: 'fr',
    })
  } catch (error) {
    console.error('Failed to resend invitation email:', error)
  }

  revalidatePath('/dashboard/team')
  return { success: true }
}

export async function getTeamData() {
  const store = await getCurrentStore()
  if (!store) {
    return { members: [], invitations: [], limits: null }
  }

  // Get members, invitations, and limits in parallel
  const [members, invitations, limits] = await Promise.all([
    db.query.storeMembers.findMany({
      where: eq(storeMembers.storeId, store.id),
      with: {
        user: true,
      },
      orderBy: [desc(storeMembers.createdAt)],
    }),
    db.query.storeInvitations.findMany({
      where: and(
        eq(storeInvitations.storeId, store.id),
        eq(storeInvitations.status, 'pending')
      ),
      orderBy: [desc(storeInvitations.createdAt)],
    }),
    canAddTeamMember(store.id),
  ])

  return { members, invitations, limits }
}
