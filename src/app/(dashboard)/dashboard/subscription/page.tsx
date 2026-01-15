import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { getCurrentStore } from '@/lib/store-context'
import { getSubscriptionWithPlan, getPlans, hasStripeCustomer } from '@/lib/stripe/subscriptions'
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

  const t = await getTranslations('dashboard.settings.subscription')
  const params = await searchParams

  // Get subscription with plan from code
  const subscription = await getSubscriptionWithPlan(store.id)

  // Get all plans from code
  const plans = getPlans()

  // Check if store has a Stripe customer (for billing portal access)
  const canAccessBillingPortal = await hasStripeCustomer(store.id)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('label')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <SubscriptionManagement
        subscription={subscription}
        plans={plans}
        canAccessBillingPortal={canAccessBillingPortal}
        showSuccess={params.success === 'true'}
        showCanceled={params.canceled === 'true'}
      />
    </div>
  )
}
