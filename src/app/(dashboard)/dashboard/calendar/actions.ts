'use server'

import { db } from '@/lib/db'
import { stores } from '@/lib/db/schema'
import { getCurrentStore } from '@/lib/store-context'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

export async function generateIcsToken() {
  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  // Generate a new 32-character token
  const token = nanoid(32)

  await db
    .update(stores)
    .set({
      icsToken: token,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, store.id))

  return { success: true, token }
}

export async function getIcsToken() {
  const store = await getCurrentStore()

  if (!store) {
    return { error: 'errors.unauthorized' }
  }

  // Return existing token or generate one if it doesn't exist
  if (store.icsToken) {
    return { success: true, token: store.icsToken }
  }

  // Generate and save a new token
  return generateIcsToken()
}

export async function regenerateIcsToken() {
  // Simply generate a new token, which invalidates the old one
  return generateIcsToken()
}
