'use server'

import { auth } from '@/lib/auth'
import { setActiveStoreId, verifyStoreAccess } from '@/lib/store-context'
import { revalidatePath } from 'next/cache'

export async function switchStore(storeId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: 'errors.unauthenticated' }
  }

  // Verify user has access to this store (includes platform admin check)
  const role = await verifyStoreAccess(storeId)

  if (!role) {
    return { error: 'errors.unauthorized' }
  }

  await setActiveStoreId(storeId)
  revalidatePath('/dashboard')
  return { success: true }
}
