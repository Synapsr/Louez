'use server'

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
