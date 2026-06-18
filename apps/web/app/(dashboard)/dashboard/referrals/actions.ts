'use server'

import { db } from '@louez/db'
import { referralRewards, stores, subscriptions } from '@louez/db'
import { and, eq } from 'drizzle-orm'
import { getCurrentStore } from '@/lib/store-context'
import { generateReferralCode } from '@/lib/utils/referral'
import { buildReferralUrl } from '@/lib/referral/link'
import { getReferralProgramConfig } from '@/lib/referral/defaults'
import { priceForLocationIndex } from '@/lib/pay-as-you-go/config'
import { getStoreBilling } from '@/lib/pay-as-you-go/metering'

export interface ReferralData {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  joinedAt: Date
  planSlug: string
  subscriptionStatus: string
  /** Whether this referral reached its Qualifying Event and paid out a Referrer Reward. */
  rewarded: boolean
}

export interface ReferralStats {
  total: number
  /** Referrals that reached the Qualifying Event (a Referrer Reward was granted). */
  qualified: number
  thisMonth: number
  /** Free reservations earned across all granted rewards. */
  freeReservationsEarned: number
  /** Monetary value of everything earned (free reservations × tariff + euro credits), in cents. */
  rewardValueCents: number
  /** Free reservations still available on this store. */
  freeReservationsRemaining: number
  currency: string
}

export interface ReferralProgramSummary {
  /** Free reservations the Referrer earns per qualified referral. */
  referrerReward: number
  /** Free reservations a Referred Store receives at sign-up. */
  referredReward: number
}

export async function getReferralData(): Promise<{
  referrals: ReferralData[]
  stats: ReferralStats
  program: ReferralProgramSummary
  referralUrl: string
  referralCode: string
} | null> {
  const store = await getCurrentStore()
  if (!store) return null

  // Ensure store has a referral code (backfill for legacy stores)
  let code = store.referralCode
  if (!code) {
    code = await ensureReferralCode(store.id)
    if (!code) return null
  }

  // Fetch all stores referred by this store
  const referredStores = await db.query.stores.findMany({
    where: eq(stores.referredByStoreId, store.id),
    columns: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      createdAt: true,
    },
    orderBy: (stores, { desc }) => [desc(stores.createdAt)],
  })

  // The Referrer Reward ledger for this store, plus the store's own billing (used to
  // value the free reservations and show how many remain).
  const [rewards, billing] = await Promise.all([
    db.query.referralRewards.findMany({
      where: and(
        eq(referralRewards.referrerStoreId, store.id),
        eq(referralRewards.status, 'granted'),
      ),
      columns: {
        referredStoreId: true,
        freeReservations: true,
        creditCents: true,
      },
    }),
    getStoreBilling(store.id),
  ])

  const rewardedIds = new Set(rewards.map((r) => r.referredStoreId))
  const unitValueCents = priceForLocationIndex(billing.config, 1)
  const freeReservationsEarned = rewards.reduce(
    (sum, r) => sum + r.freeReservations,
    0,
  )
  const creditEarnedCents = rewards.reduce((sum, r) => sum + r.creditCents, 0)
  const rewardValueCents =
    freeReservationsEarned * unitValueCents + creditEarnedCents

  // Fetch subscription data for all referred stores
  const referrals: ReferralData[] = await Promise.all(
    referredStores.map(async (ref) => {
      const sub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.storeId, ref.id),
        columns: {
          planSlug: true,
          status: true,
        },
      })

      return {
        id: ref.id,
        name: ref.name,
        slug: ref.slug,
        logoUrl: ref.logoUrl,
        joinedAt: ref.createdAt,
        planSlug: sub?.planSlug ?? 'pay_as_you_go',
        subscriptionStatus: sub?.status ?? 'active',
        rewarded: rewardedIds.has(ref.id),
      }
    })
  )

  const now = new Date()
  const stats: ReferralStats = {
    total: referrals.length,
    qualified: rewards.length,
    thisMonth: referrals.filter(
      (r) =>
        r.joinedAt.getMonth() === now.getMonth() &&
        r.joinedAt.getFullYear() === now.getFullYear()
    ).length,
    freeReservationsEarned,
    rewardValueCents,
    freeReservationsRemaining: billing.freeReservationsRemaining,
    currency: billing.config.currency,
  }

  const programConfig = getReferralProgramConfig()
  const program: ReferralProgramSummary = {
    referrerReward: programConfig.referrerRewardFreeReservations,
    referredReward: programConfig.referredRewardFreeReservations,
  }

  const referralUrl = buildReferralUrl(code)

  return { referrals, stats, program, referralUrl, referralCode: code }
}

/**
 * Generate and persist a referral code for legacy stores that don't have one.
 */
async function ensureReferralCode(storeId: string): Promise<string | null> {
  let code = generateReferralCode()

  for (let attempt = 0; attempt < 10; attempt++) {
    const exists = await db.query.stores.findFirst({
      where: eq(stores.referralCode, code),
    })
    if (!exists) break
    code = generateReferralCode()
  }

  await db
    .update(stores)
    .set({ referralCode: code, updatedAt: new Date() })
    .where(eq(stores.id, storeId))

  return code
}
