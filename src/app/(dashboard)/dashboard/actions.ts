'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { storeMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { setActiveStoreId } from '@/lib/store-context'
import { revalidatePath } from 'next/cache'

export async function switchStore(storeId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthenticated' }
  }

  // Verify user has access to this store
  const membership = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, storeId),
      eq(storeMembers.userId, session.user.id)
    ),
  })

  if (!membership) {
    return { error: 'errors.unauthorized' }
  }

  await setActiveStoreId(storeId)
  revalidatePath('/dashboard')
  return { success: true }
}
