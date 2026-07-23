'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { db, storePhoneNumbers, stores } from '@louez/db'
import { isPossibleE164PhoneNumber } from '@louez/validations'

import { env } from '@/env'
import { isVoiceAgentConfigured } from '@/lib/ai/phone/eligibility'
import {
  addOneMonthClamped,
  applyNumberRentalDebit,
  hasNumberRentalFunds,
  isNumberRentalEnabled,
} from '@/lib/ai/phone/number-billing'
import { releaseNumberBinding } from '@/lib/ai/phone/number-release'
import { log } from '@/lib/evlog'
import { getStorePlan } from '@/lib/plan-limits'
import type { Plan } from '@/lib/plans'
import { getCurrentStore } from '@/lib/store-context'
import { getVoiceProvider } from '@/lib/voice/client'
import type { AvailableNumber } from '@/lib/voice/types'

/**
 * Provisioning spends money on the operator's telephony account, so it is gated
 * to a member of the active store, on a plan that includes the voice agent, and
 * only when the operator fully configured the feature (telephony + AI). This is
 * the same gate as the rest of the voice-agent settings (updateAiPhoneSettings):
 * whoever can configure the agent can manage its number.
 */
type AuthorizeResult =
  | {
      ok: true
      store: NonNullable<Awaited<ReturnType<typeof getCurrentStore>>>
      plan: Plan
    }
  | { ok: false; error: string }

async function authorizeProvisioning(): Promise<AuthorizeResult> {
  const store = await getCurrentStore()
  if (!store) return { ok: false, error: 'errors.unauthorized' }

  const plan = await getStorePlan(store.id)
  if (!plan.features.aiPhone) {
    return { ok: false, error: 'errors.featureNotAvailable' }
  }
  if (!isVoiceAgentConfigured()) {
    return { ok: false, error: 'errors.telephonyNotConfigured' }
  }
  return { ok: true, store, plan }
}

/** Statuses that make a number binding count as "taken" for a store. */
const HELD_STATUSES = ['active', 'pending'] as const

/**
 * Atomically reserve the store's single number slot for `phoneNumber`, inserting
 * a `pending` row. Serialized per store by a row lock on `stores`, so concurrent
 * provisions can't each pass the one-number check and double-spend. Returns the
 * reserved row id, or an error key.
 */
async function reserveNumberSlot(
  storeId: string,
  phoneNumber: string,
): Promise<{ ok: true; rowId: string } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    // Serialize all provisioning for this store on the (always-present) store row.
    await tx.execute(sql`SELECT id FROM ${stores} WHERE id = ${storeId} FOR UPDATE`)

    const held = await tx.query.storePhoneNumbers.findFirst({
      where: and(
        eq(storePhoneNumbers.storeId, storeId),
        inArray(storePhoneNumbers.status, [...HELD_STATUSES]),
      ),
      columns: { id: true },
    })
    if (held) return { ok: false as const, error: 'errors.numberAlreadyBound' }

    const owner = await tx.query.storePhoneNumbers.findFirst({
      where: eq(storePhoneNumbers.e164, phoneNumber),
      columns: { id: true },
    })
    if (owner) return { ok: false as const, error: 'errors.phoneNumberInUse' }

    const [row] = await tx
      .insert(storePhoneNumbers)
      .values({
        storeId,
        e164: phoneNumber,
        provider: env.VOICE_PROVIDER ?? 'twilio',
        status: 'pending',
      })
      .$returningId()
    return { ok: true as const, rowId: row.id }
  })
}

/** Search numbers available to provision (read-only, no spend). */
export async function searchVoiceNumbers(input: {
  country: string
  areaCode?: string
  contains?: string
}): Promise<{ numbers: AvailableNumber[] } | { error: string }> {
  const auth = await authorizeProvisioning()
  if (!auth.ok) return { error: auth.error }

  const country = (input.country || 'FR').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return { error: 'errors.invalidData' }

  try {
    const numbers = await getVoiceProvider().searchAvailableNumbers({
      country,
      areaCode: input.areaCode?.trim() || undefined,
      contains: input.contains?.trim() || undefined,
      limit: 12,
    })
    return { numbers }
  } catch (error) {
    log.error(
      'phone',
      `number search failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return { error: 'errors.numberSearchFailed' }
  }
}

/** Provision (buy) a number, point it at the app webhooks, and bind it. */
export async function provisionVoiceNumber(input: {
  phoneNumber: string
}): Promise<{ e164: string } | { error: string }> {
  const auth = await authorizeProvisioning()
  if (!auth.ok) return { error: auth.error }
  const { store, plan } = auth

  const phoneNumber = input.phoneNumber?.trim()
  if (!phoneNumber || !isPossibleE164PhoneNumber(phoneNumber)) {
    return { error: 'errors.invalidPhoneNumber' }
  }

  // The rental (first cycle) is paid in credits at activation: refuse upfront
  // when the balance can't cover it, before any money is spent provider-side.
  if (isNumberRentalEnabled() && !(await hasNumberRentalFunds(store.id, plan))) {
    return { error: 'errors.insufficientAiCredits' }
  }

  // Reserve the slot BEFORE spending money, so the purchase is guarded by the
  // one-number invariant and a failure can't leave the store double-booked.
  const reserved = await reserveNumberSlot(store.id, phoneNumber)
  if (!reserved.ok) return { error: reserved.error }

  let provisioned: { e164: string; providerNumberId: string }
  try {
    provisioned = await getVoiceProvider().provisionNumber({
      phoneNumber,
      voiceUrl: `${env.NEXT_PUBLIC_APP_URL}/api/voice/incoming`,
      statusCallbackUrl: `${env.NEXT_PUBLIC_APP_URL}/api/voice/status`,
    })
  } catch (error) {
    // Purchase failed: drop the reservation so the slot is free again.
    await db
      .delete(storePhoneNumbers)
      .where(eq(storePhoneNumbers.id, reserved.rowId))
      .catch(() => {})
    log.error(
      'phone',
      `provisioning failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return { error: 'errors.provisioningFailed' }
  }

  // Activation and first rental debit commit atomically: either the number is
  // active with its cycle paid and anchored, or nothing happened.
  const activatedAt = new Date()
  try {
    await db.transaction(async (tx) => {
      // Re-take the reservation under lock: a concurrent release (manual, or
      // disable-the-agent) may have deleted it while the provider purchase was
      // in flight — charging the rental for a vanished binding is never OK.
      const [reservedRow] = await tx
        .select({ id: storePhoneNumbers.id })
        .from(storePhoneNumbers)
        .where(eq(storePhoneNumbers.id, reserved.rowId))
        .for('update')
      if (!reservedRow) throw new Error('reservation_lost')

      await tx
        .update(storePhoneNumbers)
        .set({
          e164: provisioned.e164,
          providerNumberId: provisioned.providerNumberId,
          status: 'active',
          nextRenewalAt: isNumberRentalEnabled()
            ? addOneMonthClamped(activatedAt)
            : null,
          updatedAt: activatedAt,
        })
        .where(eq(storePhoneNumbers.id, reserved.rowId))

      if (isNumberRentalEnabled()) {
        const debit = await applyNumberRentalDebit(tx, {
          storeId: store.id,
          numberId: reserved.rowId,
          cycleDate: activatedAt,
          plan,
        })
        if (debit !== 'debited' && debit !== 'already' && debit !== 'disabled') {
          // Balance drained between the precheck and here — abort everything.
          throw new Error('insufficient_rental_credits')
        }
      }
    })
  } catch (error) {
    // We already paid the provider: hand the number back, then drop the
    // reservation. If the hand-back FAILS, keep the row (still 'pending',
    // invisible to call routing) with the provider id stamped on it — deleting
    // it would erase the only record of a number we still own provider-side.
    try {
      await getVoiceProvider().releaseNumber(provisioned.providerNumberId)
      await db
        .delete(storePhoneNumbers)
        .where(eq(storePhoneNumbers.id, reserved.rowId))
    } catch (releaseError) {
      await db
        .update(storePhoneNumbers)
        .set({
          e164: provisioned.e164,
          providerNumberId: provisioned.providerNumberId,
          updatedAt: new Date(),
        })
        .where(eq(storePhoneNumbers.id, reserved.rowId))
        .catch(() => {})
      log.error(
        'phone',
        `provisioning compensation could not hand the number back (row kept for manual cleanup): ${
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError)
        }`,
      )
    }
    const insufficient =
      error instanceof Error && error.message === 'insufficient_rental_credits'
    if (!insufficient) {
      log.error(
        'phone',
        `provisioning finalize failed (number released): ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    return {
      error: insufficient
        ? 'errors.insufficientAiCredits'
        : 'errors.provisioningFailed',
    }
  }

  revalidatePath('/dashboard/ai-assistant')
  return { e164: provisioned.e164 }
}

/**
 * Bind a number the merchant already owns (no purchase, no provider config).
 * They point its voice webhook at the app themselves — the advanced path next to
 * auto-provisioning. Serialized per store, and rejects a number already bound.
 */
export async function linkVoiceNumber(input: {
  phoneNumber: string
}): Promise<{ e164: string } | { error: string }> {
  const auth = await authorizeProvisioning()
  if (!auth.ok) return { error: auth.error }
  const { store } = auth

  const phoneNumber = input.phoneNumber?.trim()
  if (!phoneNumber || !isPossibleE164PhoneNumber(phoneNumber)) {
    return { error: 'errors.invalidPhoneNumber' }
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM ${stores} WHERE id = ${store.id} FOR UPDATE`)

    const held = await tx.query.storePhoneNumbers.findFirst({
      where: and(
        eq(storePhoneNumbers.storeId, store.id),
        inArray(storePhoneNumbers.status, [...HELD_STATUSES]),
      ),
      columns: { id: true },
    })
    if (held) return { ok: false as const, error: 'errors.numberAlreadyBound' }

    const owner = await tx.query.storePhoneNumbers.findFirst({
      where: eq(storePhoneNumbers.e164, phoneNumber),
      columns: { id: true },
    })
    if (owner) return { ok: false as const, error: 'errors.phoneNumberInUse' }

    // No providerNumberId: a linked number is not provider-managed, so release()
    // never tries to hand back a number we don't own.
    await tx.insert(storePhoneNumbers).values({
      storeId: store.id,
      e164: phoneNumber,
      provider: env.VOICE_PROVIDER ?? 'twilio',
      status: 'active',
    })
    return { ok: true as const }
  })

  if (!result.ok) return { error: result.error }
  revalidatePath('/dashboard/ai-assistant')
  return { e164: phoneNumber }
}

/** Release the store's active number and remove the binding entirely. */
export async function releaseVoiceNumber(): Promise<
  { success: true } | { error: string }
> {
  const auth = await authorizeProvisioning()
  if (!auth.ok) return { error: auth.error }
  const { store } = auth

  const binding = await db.query.storePhoneNumbers.findFirst({
    where: and(
      eq(storePhoneNumbers.storeId, store.id),
      inArray(storePhoneNumbers.status, [...HELD_STATUSES]),
    ),
    columns: { id: true, providerNumberId: true },
  })
  if (!binding) return { error: 'errors.noActiveNumber' }

  const released = await releaseNumberBinding(binding)
  if (!released.ok) return { error: 'errors.releaseFailed' }

  revalidatePath('/dashboard/ai-assistant')
  return { success: true }
}
