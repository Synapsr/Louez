import { and, eq, isNotNull, lte, or, isNull } from 'drizzle-orm'

import { db, storeMembers, storePhoneNumbers, stores, users } from '@louez/db'
import type { AiPhoneSettings, StoreSettings } from '@louez/types'

import {
  addOneMonthClamped,
  debitNumberRental,
  hasNumberRentalFunds,
  isNumberRentalEnabled,
} from '@/lib/ai/phone/number-billing'
import { releaseNumberBinding } from '@/lib/ai/phone/number-release'
import { maybeTriggerAutoTopup } from '@/lib/ai/advisor/auto-topup'
import { getNumberRentalCredits } from '@/lib/ai/pricing'
import { sendVoiceNumberBillingEmail } from '@/lib/email/send'
import { getLocaleFromCountry } from '@/lib/email/i18n'
import { log } from '@/lib/evlog'
import { getStorePlan } from '@/lib/plan-limits'

// Product behavior of the renewal lifecycle (not commercial values): warn 3
// days before a renewal the balance can't cover, remind 3 days into the grace
// window, release the number 7 days after the first failed attempt. The debit
// itself is retried on every daily run, so a recharge (manual or auto-top-up)
// heals the cycle without any action.
const WARN_BEFORE_MS = 3 * 24 * 60 * 60 * 1000
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000
const RELEASE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export type NumberRenewalStats = {
  scanned: number
  backfilled: number
  renewed: number
  warned: number
  failed: number
  reminded: number
  released: number
  errors: number
}

/** Owner email for billing notices: store contact first, then the owner member. */
async function resolveOwnerEmail(store: {
  id: string
  email: string | null
}): Promise<string | null> {
  if (store.email) return store.email
  const owner = await db
    .select({ email: users.email })
    .from(storeMembers)
    .innerJoin(users, eq(storeMembers.userId, users.id))
    .where(
      and(eq(storeMembers.storeId, store.id), eq(storeMembers.role, 'owner')),
    )
    .limit(1)
  return owner[0]?.email ?? null
}

/**
 * Daily renewal pass over every provisioned number (linked/BYO numbers carry no
 * rental and are never touched). For each number due within the look-ahead
 * window: warn when the balance won't cover the upcoming renewal, debit when
 * due (anchored on the due date, exactly-once per cycle), and walk the grace
 * flow (fail → remind → release) while retrying the debit daily.
 */
export async function processVoiceNumberRenewals(
  now: Date,
): Promise<NumberRenewalStats | { skipped: true }> {
  if (!isNumberRentalEnabled()) return { skipped: true }

  const stats: NumberRenewalStats = {
    scanned: 0,
    backfilled: 0,
    renewed: 0,
    warned: 0,
    failed: 0,
    reminded: 0,
    released: 0,
    errors: 0,
  }

  const warnHorizon = new Date(now.getTime() + WARN_BEFORE_MS)
  const bindings = await db
    .select({
      id: storePhoneNumbers.id,
      storeId: storePhoneNumbers.storeId,
      e164: storePhoneNumbers.e164,
      providerNumberId: storePhoneNumbers.providerNumberId,
      nextRenewalAt: storePhoneNumbers.nextRenewalAt,
      renewalWarnedAt: storePhoneNumbers.renewalWarnedAt,
      renewalFailedAt: storePhoneNumbers.renewalFailedAt,
      renewalRemindedAt: storePhoneNumbers.renewalRemindedAt,
      createdAt: storePhoneNumbers.createdAt,
    })
    .from(storePhoneNumbers)
    .where(
      and(
        eq(storePhoneNumbers.status, 'active'),
        isNotNull(storePhoneNumbers.providerNumberId),
        or(
          isNull(storePhoneNumbers.nextRenewalAt),
          lte(storePhoneNumbers.nextRenewalAt, warnHorizon),
        ),
      ),
    )

  for (const binding of bindings) {
    stats.scanned += 1
    try {
      const store = await db.query.stores.findFirst({
        where: eq(stores.id, binding.storeId),
        columns: {
          id: true,
          name: true,
          email: true,
          settings: true,
          aiPhoneSettings: true,
        },
      })
      if (!store) continue

      const settings = store.settings as StoreSettings | null
      const phoneSettings = store.aiPhoneSettings as AiPhoneSettings | null
      const locale = getLocaleFromCountry(settings?.country)
      const rentalCredits = getNumberRentalCredits()
      const ownerEmail = await resolveOwnerEmail(store)

      // A number bound to a DISABLED agent serves no calls but keeps costing
      // rental: release it (the disable path now does this; this covers
      // pre-reform leftovers) and tell the owner. Checked BEFORE the anchor
      // backfill, so a leftover is cleaned on the first run, not next month.
      if (phoneSettings && phoneSettings.enabled === false) {
        const released = await releaseNumberBinding(binding)
        if (released.ok) {
          stats.released += 1
          if (ownerEmail) {
            await sendVoiceNumberBillingEmail({
              variant: 'released',
              to: ownerEmail,
              storeId: store.id,
              storeName: store.name,
              e164: binding.e164,
              credits: rentalCredits,
              locale,
            }).catch(() => {})
          }
        }
        continue
      }

      // Pre-reform numbers have no billing anchor yet: give them a fresh cycle
      // starting now (no retroactive charge) and pick them up next month.
      if (!binding.nextRenewalAt) {
        await db
          .update(storePhoneNumbers)
          .set({ nextRenewalAt: addOneMonthClamped(now), updatedAt: now })
          .where(eq(storePhoneNumbers.id, binding.id))
        stats.backfilled += 1
        continue
      }

      const plan = await getStorePlan(store.id)

      if (now < binding.nextRenewalAt) {
        // Inside the warn window, renewal not due yet: warn once per cycle if
        // the balance can't cover it. The stamp lands only when the notice was
        // actually delivered (or there is no address to deliver to), so a
        // failed send retries on the next daily run.
        if (
          !binding.renewalWarnedAt &&
          !(await hasNumberRentalFunds(store.id, plan))
        ) {
          let delivered = !ownerEmail
          if (ownerEmail) {
            delivered = await sendVoiceNumberBillingEmail({
              variant: 'warning',
              to: ownerEmail,
              storeId: store.id,
              storeName: store.name,
              e164: binding.e164,
              credits: rentalCredits,
              deadline: binding.nextRenewalAt,
              locale,
            })
              .then(() => true)
              .catch(() => false)
          }
          if (delivered) {
            await db
              .update(storePhoneNumbers)
              .set({ renewalWarnedAt: now, updatedAt: now })
              .where(eq(storePhoneNumbers.id, binding.id))
            stats.warned += 1
          }
        }
        continue
      }

      // Renewal due: attempt the debit, anchored on the DUE date so the cycle
      // never drifts and the dedup key is stable across daily retries. The
      // binding row is re-checked under the debit's lock, so a concurrent
      // release is never charged for.
      const result = await debitNumberRental({
        storeId: store.id,
        numberId: binding.id,
        cycleDate: binding.nextRenewalAt,
        plan,
        requireBindingRow: true,
      })

      if (result === 'debited' || result === 'already') {
        await db
          .update(storePhoneNumbers)
          .set({
            // Advance from the DUE date, springing back to the activation's
            // day-of-month after a clamped month (Feb 28 → Mar 31, not Mar 28).
            nextRenewalAt: addOneMonthClamped(
              binding.nextRenewalAt,
              binding.createdAt.getDate(),
            ),
            renewalWarnedAt: null,
            renewalFailedAt: null,
            renewalRemindedAt: null,
            updatedAt: now,
          })
          .where(eq(storePhoneNumbers.id, binding.id))
        stats.renewed += 1
        continue
      }
      if (result === 'disabled' || result === 'gone') continue
      if (result === 'error') {
        // Infrastructure failure — NOT a funds problem. No emails, no grace
        // stamps: the daily retry handles it, and a solvent store must never
        // be walked toward losing its number over an outage.
        stats.errors += 1
        continue
      }

      // Insufficient balance. Nudge the auto-top-up (idempotent, hourly-deduped);
      // if it lands, tomorrow's retry heals the cycle.
      await maybeTriggerAutoTopup(store.id).catch(() => {})

      if (!binding.renewalFailedAt) {
        if (ownerEmail) {
          await sendVoiceNumberBillingEmail({
            variant: 'failed',
            to: ownerEmail,
            storeId: store.id,
            storeName: store.name,
            e164: binding.e164,
            credits: rentalCredits,
            deadline: new Date(now.getTime() + RELEASE_AFTER_MS),
            locale,
          }).catch(() => {})
        }
        await db
          .update(storePhoneNumbers)
          .set({ renewalFailedAt: now, updatedAt: now })
          .where(eq(storePhoneNumbers.id, binding.id))
        stats.failed += 1
        continue
      }

      const graceElapsed = now.getTime() - binding.renewalFailedAt.getTime()

      if (graceElapsed >= RELEASE_AFTER_MS) {
        const released = await releaseNumberBinding(binding)
        if (released.ok) {
          stats.released += 1
          if (ownerEmail) {
            await sendVoiceNumberBillingEmail({
              variant: 'released',
              to: ownerEmail,
              storeId: store.id,
              storeName: store.name,
              e164: binding.e164,
              credits: rentalCredits,
              locale,
            }).catch(() => {})
          }
        }
        continue
      }

      if (graceElapsed >= REMIND_AFTER_MS && !binding.renewalRemindedAt) {
        // As with the warning: only stamp once the reminder actually went out.
        let delivered = !ownerEmail
        if (ownerEmail) {
          delivered = await sendVoiceNumberBillingEmail({
            variant: 'failed',
            to: ownerEmail,
            storeId: store.id,
            storeName: store.name,
            e164: binding.e164,
            credits: rentalCredits,
            deadline: new Date(
              binding.renewalFailedAt.getTime() + RELEASE_AFTER_MS,
            ),
            locale,
          })
            .then(() => true)
            .catch(() => false)
        }
        if (delivered) {
          await db
            .update(storePhoneNumbers)
            .set({ renewalRemindedAt: now, updatedAt: now })
            .where(eq(storePhoneNumbers.id, binding.id))
          stats.reminded += 1
        }
      }
    } catch (error) {
      stats.errors += 1
      log.error(
        'phone',
        `number renewal failed for binding ${binding.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return stats
}
