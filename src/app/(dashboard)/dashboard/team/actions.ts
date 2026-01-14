'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, storeMembers, stores } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getCurrentStoreId, hasPermission, verifyStoreAccess } from '@/lib/store-context'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

const addMemberSchema = z.object({
  email: z.string().email(),
})

export async function addMember(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthenticated' }
  }

  const email = formData.get('email') as string
  const validated = addMemberSchema.safeParse({ email })
  if (!validated.success) {
    return { error: 'errors.invalidEmail' }
  }

  const storeId = await getCurrentStoreId()
  if (!storeId) {
    return { error: 'errors.storeNotFound' }
  }

  // Verify user has permission to manage members
  const role = await verifyStoreAccess(storeId)
  if (!role || !hasPermission(role, 'manage_members')) {
    return { error: 'errors.unauthorized' }
  }

  // Find user by email
  const userToAdd = await db.query.users.findFirst({
    where: eq(users.email, validated.data.email),
  })

  if (!userToAdd) {
    return { error: 'dashboard.team.userNotFound' }
  }

  // Check if already a member
  const existingMember = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, storeId),
      eq(storeMembers.userId, userToAdd.id)
    ),
  })

  if (existingMember) {
    return { error: 'dashboard.team.alreadyMember' }
  }

  // Add member
  await db.insert(storeMembers).values({
    storeId,
    userId: userToAdd.id,
    role: 'member',
    addedBy: session.user.id,
  })

  revalidatePath('/dashboard/settings/team')
  return { success: true }
}

export async function removeMember(memberId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthenticated' }
  }

  const storeId = await getCurrentStoreId()
  if (!storeId) {
    return { error: 'errors.storeNotFound' }
  }

  // Verify user has permission to manage members
  const role = await verifyStoreAccess(storeId)
  if (!role || !hasPermission(role, 'manage_members')) {
    return { error: 'errors.unauthorized' }
  }

  // Get member to remove
  const member = await db.query.storeMembers.findFirst({
    where: eq(storeMembers.id, memberId),
  })

  if (!member || member.storeId !== storeId) {
    return { error: 'errors.notFound' }
  }

  // Cannot remove owner
  if (member.role === 'owner') {
    return { error: 'dashboard.team.cannotRemoveOwner' }
  }

  // Cannot remove self
  if (member.userId === session.user.id) {
    return { error: 'dashboard.team.cannotRemoveSelf' }
  }

  await db.delete(storeMembers).where(eq(storeMembers.id, memberId))

  revalidatePath('/dashboard/settings/team')
  return { success: true }
}

export async function getTeamMembers() {
  const session = await auth()
  if (!session?.user?.id) {
    return []
  }

  const storeId = await getCurrentStoreId()
  if (!storeId) {
    return []
  }

  // Verify user has access to this store
  const role = await verifyStoreAccess(storeId)
  if (!role) {
    return []
  }

  // Get all members with user info
  const members = await db
    .select({
      id: storeMembers.id,
      role: storeMembers.role,
      createdAt: storeMembers.createdAt,
      userId: storeMembers.userId,
      userName: users.name,
      userEmail: users.email,
      userImage: users.image,
    })
    .from(storeMembers)
    .innerJoin(users, eq(storeMembers.userId, users.id))
    .where(eq(storeMembers.storeId, storeId))
    .orderBy(storeMembers.role, storeMembers.createdAt)

  return members
}
