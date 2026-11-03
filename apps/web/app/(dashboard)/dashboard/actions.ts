'use server'

import { eq } from 'drizzle-orm'

import { db, users } from '@louez/db'

import { auth } from '@/lib/auth'
import { dismissibleNoticeIdSchema, parseDismissedNotices } from '@/lib/dashboard/dismissed-notices'
import { isStandaloneMode } from '@/lib/deployment'
import { setActiveStoreId, verifyStoreAccess } from '@/lib/store-context'
import { revalidatePath } from 'next/cache'

export async function switchStore(storeId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthenticated' }
  }

  // Standalone instances host a single store; the switcher UI is hidden and
  // the action is denied so it cannot be reached through the API either.
  if (isStandaloneMode()) {
    return { error: 'errors.unauthorized' }
  }

  // setActiveStoreId now validates access internally (defense in depth)
  // but we keep verifyStoreAccess for the explicit role check
  const role = await verifyStoreAccess(storeId)

  if (!role) {
    return { error: 'errors.unauthorized' }
  }

  const result = await setActiveStoreId(storeId)
  if (!result.success) {
    return { error: result.error || 'errors.unauthorized' }
  }

  revalidatePath('/dashboard')
  return { success: true }
}

/** Closes an informational notice for good, for this user on every device. */
export async function dismissNotice(noticeId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthenticated' }
  }

  const parsed = dismissibleNoticeIdSchema.safeParse(noticeId)
  if (!parsed.success) {
    return { error: 'errors.invalidData' }
  }

  // Merged server-side so a second tab cannot erase what the first one closed.
  const row = await db.query.users.findFirst({
    columns: { dismissedNotices: true },
    where: eq(users.id, session.user.id),
  })
  const dismissed = parseDismissedNotices(row?.dismissedNotices)
  if (dismissed.includes(parsed.data)) {
    return { success: true }
  }

  await db
    .update(users)
    .set({ dismissedNotices: [...dismissed, parsed.data], updatedAt: new Date() })
    .where(eq(users.id, session.user.id))

  return { success: true }
}
