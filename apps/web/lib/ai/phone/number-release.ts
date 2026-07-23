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
 *
 * The row is re-read FOR UPDATE first: a provision finalize that is activating
 * this very row (setting providerNumberId) holds its lock until commit, so the
 * decision "is there a provider-side number to hand back?" is never made on a
 * stale snapshot — without this, a release racing a provision could delete the
 * row while skipping the provider hand-back, orphaning a paid number.
 */
export async function releaseNumberBinding(binding: {
  id: string
  providerNumberId: string | null
}): Promise<{ ok: true } | { ok: false; error: 'releaseFailed' }> {
  const [fresh] = await db.transaction((tx) =>
    tx
      .select({
        id: storePhoneNumbers.id,
        providerNumberId: storePhoneNumbers.providerNumberId,
      })
      .from(storePhoneNumbers)
      .where(eq(storePhoneNumbers.id, binding.id))
      .for('update'),
  )
  // Already gone (concurrent release): nothing left to do.
  if (!fresh) return { ok: true }

  if (fresh.providerNumberId) {
    try {
      await getVoiceProvider().releaseNumber(fresh.providerNumberId)
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
