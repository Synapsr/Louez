'use server'

import { auth } from '@/lib/auth'
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
