'use server'

import { eq } from 'drizzle-orm'

import { db, users } from '@louez/db'

import { auth } from '@/lib/auth'
import { dismissibleNoticeIdSchema, parseDismissedNotices } from '@/lib/dashboard/dismissed-notices'
import { switchActiveStore } from '@/lib/store-context'
import { revalidatePath } from 'next/cache'

export async function switchStore(storeId: string) {
  // The check is shared with the dashboard links that name a store
  // (app/api/active-store); standalone instances never switch.
  const result = await switchActiveStore(storeId)
  if (!result.success) {
    return { error: result.error }
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
