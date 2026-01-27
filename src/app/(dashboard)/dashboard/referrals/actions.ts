'use server'

import { db } from '@/lib/db'
import { stores, subscriptions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getCurrentStore } from '@/lib/store-context'
import { generateReferralCode } from '@/lib/utils/referral'

export interface ReferralData {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  joinedAt: Date
  planSlug: string
  subscriptionStatus: string
}

export interface ReferralStats {
  total: number
  activePaid: number
  thisMonth: number
}

export async function getReferralData(): Promise<{
  referrals: ReferralData[]
  stats: ReferralStats
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
        planSlug: sub?.planSlug ?? 'start',
        subscriptionStatus: sub?.status ?? 'active',
      }
    })
  )

  const now = new Date()
  const stats: ReferralStats = {
    total: referrals.length,
    activePaid: referrals.filter(
      (r) => r.subscriptionStatus === 'active' && r.planSlug !== 'start'
    ).length,
    thisMonth: referrals.filter(
      (r) =>
        r.joinedAt.getMonth() === now.getMonth() &&
        r.joinedAt.getFullYear() === now.getFullYear()
    ).length,
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const referralUrl = `${appUrl}/login?ref=${code}`

  return { referrals, stats, referralUrl, referralCode: code }
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
