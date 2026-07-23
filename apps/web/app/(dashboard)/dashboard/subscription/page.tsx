import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { after } from 'next/server'

import { getCurrentStore } from '@/lib/store-context'
import { syncStorePaymentMethodStatus } from '@/lib/discord/platform-notifications'
import { getSubscriptionWithPlan, getPlans, hasStripeCustomer, storeHasDefaultPaymentMethod } from '@/lib/stripe/subscriptions'
import { getStoreUsage, canAddTeamMember, canSendSms, getStorePlan } from '@/lib/plan-limits'
import { getStoreBilling, getCurrentMonthUsage, getRecentPayAsYouGoInvoices, summarizePayAsYouGoBands } from '@/lib/pay-as-you-go'
import { getAiCreditsInfo, microToCredits } from '@/lib/ai/advisor/credits'
import { areAiCreditsEnabled, getAiCreditPackages } from '@/lib/plans'
import { Button } from '@louez/ui'
import { SubscriptionManagement } from './subscription-management'
import { PayAsYouGoSummary } from './pay-as-you-go-summary'
import { PayAsYouGoPreview } from './pay-as-you-go-preview'
import {
  AiCreditsSection,
  type AiCreditsSectionProps,
} from '../ai-assistant/ai-credits-section'

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{
    success?: string
    canceled?: string
    plans?: string
    payg?: string
    topup?: string
  }>
}) {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings.subscription')
  const params = await searchParams

  // Pay-as-you-go stores get a usage summary instead of the plan grid — unless they
  // explicitly asked to see the plans (?plans=1) to switch to a subscription.
  const billing = await getStoreBilling(store.id)

  // AI credit recharge (cloud commercial add-on), surfaced on the billing page
  // in compact form (balance + recharge). Null unless the operator enabled it,
  // and skipped on the transient PAYG-tariff preview (which never renders it).
  const isPayAsYouGoPreview =
    Boolean(params.payg) && billing.billingMode !== 'pay_as_you_go'
  let credits: AiCreditsSectionProps | null = null
  if (areAiCreditsEnabled() && !isPayAsYouGoPreview) {
    const plan = await getStorePlan(store.id)
    const info = await getAiCreditsInfo(store.id, plan)
    const packages = getAiCreditPackages()
    credits = {
      monthlyIncludedCredits:
        info.monthlyIncludedMicro === null
          ? null
          : microToCredits(info.monthlyIncludedMicro),
      monthlyRemainingCredits:
        info.monthlyRemainingMicro === null
          ? null
          : microToCredits(info.monthlyRemainingMicro),
      prepaidCredits: microToCredits(info.prepaidBalanceMicro),
      autoTopup: {
        enabled: info.autoTopupEnabled,
        thresholdCredits: info.autoTopupThresholdMicro
          ? microToCredits(info.autoTopupThresholdMicro)
          : 0,
        packIndex: packages.findIndex(
          (p) =>
            p.credits === info.autoTopupCredits &&
            p.priceCents === info.autoTopupPriceCents,
        ),
      },
      packages,
      history: [],
      topupStatus:
        params.topup === 'success' || params.topup === 'cancelled'
          ? params.topup
          : null,
      compact: true,
      returnPath: '/dashboard/subscription',
    }
  }

  if (billing.billingMode === 'pay_as_you_go' && !params.plans) {
    const [usage, invoices, hasPaymentMethod] = await Promise.all([
      getCurrentMonthUsage(store.id, new Date(), billing),
      getRecentPayAsYouGoInvoices(store.id),
      storeHasDefaultPaymentMethod(store.id),
    ])

    // Sync the owner's card status to fromHello (drives activation journeys:
    // nudge pay-as-you-go owners to add a card and "lock" their offer).
    after(() => syncStorePaymentMethodStatus(store.id, hasPaymentMethod))

    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('label')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>

        <PayAsYouGoSummary
          billingMonth={usage.billingMonth}
          locationCount={usage.locationCount}
          grossCents={usage.grossCents}
          collectedAtSourceCents={usage.collectedAtSourceCents}
          dueCents={usage.dueCents}
          currency={usage.currency}
          flatRateCents={usage.config.flatRateCents}
          bands={usage.bands}
          hasPaymentMethod={hasPaymentMethod}
          invoices={invoices}
          freeReservationsRemaining={billing.freeReservationsRemaining}
          freeReservationsGranted={billing.freeReservationsGranted}
        />

        {credits && <AiCreditsSection {...credits} />}
      </div>
    )
  }

  const isPayAsYouGo = billing.billingMode === 'pay_as_you_go'

  // Get subscription with plan from code
  const subscription = await getSubscriptionWithPlan(store.id)

  // Subscription store previewing the pay-as-you-go tariffs before activating.
  if (params.payg && !isPayAsYouGo) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('label')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>

        <PayAsYouGoPreview
          flatRateCents={billing.config.flatRateCents}
          bands={summarizePayAsYouGoBands(billing.config)}
          currency={billing.config.currency}
          isPaidPlan={Boolean(subscription?.stripeSubscriptionId)}
        />
      </div>
    )
  }

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
        <Button variant="outline" render={<Link href="/dashboard/sms" />}>
            <MessageSquare className="mr-2 h-4 w-4" />
            {tSms('title')}
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
        pendingBillingMode={subscription?.pendingBillingMode ?? null}
        showBackToPayAsYouGo={isPayAsYouGo}
      />

      {credits && <AiCreditsSection {...credits} />}
    </div>
  )
}
