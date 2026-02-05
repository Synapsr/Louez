import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'

import { getCurrentStore } from '@/lib/store-context'
import { getSubscriptionWithPlan, getPlans, hasStripeCustomer } from '@/lib/stripe/subscriptions'
import { getStoreUsage, canAddTeamMember, canSendSms } from '@/lib/plan-limits'
import { Button } from '@louez/ui'
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

  // Get current usage statistics
  const [usage, teamStatus, smsStatus] = await Promise.all([
    getStoreUsage(store.id),
    canAddTeamMember(store.id),
    canSendSms(store.id),
  ])

  const tSms = await getTranslations('dashboard.sms')

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('label')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/sms">
            <MessageSquare className="mr-2 h-4 w-4" />
            {tSms('title')}
          </Link>
        </Button>
      </div>

      <SubscriptionManagement
        subscription={subscription}
        plans={plans}
        canAccessBillingPortal={canAccessBillingPortal}
        showSuccess={params.success === 'true'}
        showCanceled={params.canceled === 'true'}
        usage={{
          products: usage.products,
          reservations: usage.reservationsThisMonth,
          customers: usage.customers,
          collaborators: teamStatus.current,
          collaboratorsLimit: teamStatus.limit,
          sms: smsStatus.current,
          smsLimit: smsStatus.limit,
        }}
        discountPercent={store.discountPercent}
        discountDurationMonths={store.discountDurationMonths}
      />
    </div>
  )
}
