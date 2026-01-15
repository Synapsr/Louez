import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { SettingsNav } from '@/components/dashboard/settings-nav'
import { db } from '@/lib/db'
import { subscriptions, subscriptionPayments, subscriptionPlans } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { SubscriptionManagement } from './subscription-management'

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>
}) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings')
  const params = await searchParams

  // Get subscription with plan
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, store.id),
    with: {
      plan: true,
    },
  })

  // Get payment history
  const payments = subscription
    ? await db.query.subscriptionPayments.findMany({
        where: eq(subscriptionPayments.subscriptionId, subscription.id),
        orderBy: [desc(subscriptionPayments.createdAt)],
        limit: 12,
      })
    : []

  // Get all plans for upgrade options
  const plans = await db.query.subscriptionPlans.findMany({
    where: eq(subscriptionPlans.isActive, true),
    orderBy: (plans, { asc }) => [asc(plans.displayOrder)],
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subscription.description')}</p>
      </div>

      <SettingsNav />

      <SubscriptionManagement
        subscription={subscription ?? null}
        payments={payments}
        plans={plans}
        showSuccess={params.success === 'true'}
        showCanceled={params.canceled === 'true'}
      />
    </div>
  )
}
