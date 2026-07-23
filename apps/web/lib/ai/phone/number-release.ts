import { eq } from 'drizzle-orm'

import { db, storePhoneNumbers } from '@louez/db'

import { log } from '@/lib/evlog'
import { getVoiceProvider } from '@/lib/voice/client'

/**
 * Release a store's number binding: hand a provisioned number back to the
 * telephony provider (stops its monthly rental) and delete the row — the e164
 * is globally unique, so a kept row would block every other store from ever
 * taking the freed number. Linked (BYO) numbers just drop the binding.
 * Shared by the manual release action, the disable-the-agent path, and the
 * renewal job's end-of-grace release.
 */
export async function releaseNumberBinding(binding: {
  id: string
  providerNumberId: string | null
}): Promise<{ ok: true } | { ok: false; error: 'releaseFailed' }> {
  if (binding.providerNumberId) {
    try {
      await getVoiceProvider().releaseNumber(binding.providerNumberId)
    } catch (error) {
      log.error(
        'phone',
        `release failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return { ok: false, error: 'releaseFailed' }
    }
  }

  await db
    .delete(storePhoneNumbers)
    .where(eq(storePhoneNumbers.id, binding.id))

  return { ok: true }
}
