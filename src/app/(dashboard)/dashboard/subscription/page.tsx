import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { Check, Sparkles, Zap, Building2 } from 'lucide-react'

import { getCurrentStore } from '@/lib/store-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { PlanFeatures } from '@/types'

// Default plans matching retours.txt pricing
const defaultPlans = [
  {
    id: 'start',
    slug: 'start',
    price: 0,
    originalPrice: null,
    interval: 'monthly' as const,
    isPopular: false,
    icon: Sparkles,
    features: {
      maxProducts: 3,
      maxReservationsPerMonth: null,
      maxCustomers: null,
      maxCollaborators: 0,
      customDomain: false,
      analytics: false,
      emailNotifications: true,
      prioritySupport: false,
      apiAccess: false,
      whiteLabel: false,
      onlinePayment: false,
      customerPortal: false,
      reviewBooster: false,
      phoneSupport: false,
      dedicatedManager: false,
    } as PlanFeatures,
  },
  {
    id: 'pro',
    slug: 'pro',
    price: 28,
    originalPrice: 56,
    interval: 'monthly' as const,
    isPopular: true,
    icon: Zap,
    features: {
      maxProducts: 20,
      maxReservationsPerMonth: null,
      maxCustomers: null,
      maxCollaborators: 5,
      customDomain: false,
      analytics: true,
      emailNotifications: true,
      prioritySupport: true,
      apiAccess: false,
      whiteLabel: false,
      onlinePayment: true,
      customerPortal: false,
      reviewBooster: false,
      phoneSupport: false,
      dedicatedManager: false,
    } as PlanFeatures,
  },
  {
    id: 'ultra',
    slug: 'ultra',
    price: 85,
    originalPrice: 170,
    interval: 'monthly' as const,
    isPopular: false,
    icon: Building2,
    features: {
      maxProducts: null,
      maxReservationsPerMonth: null,
      maxCustomers: null,
      maxCollaborators: null,
      customDomain: true,
      analytics: true,
      emailNotifications: true,
      prioritySupport: true,
      apiAccess: true,
      whiteLabel: true,
      onlinePayment: true,
      customerPortal: true,
      reviewBooster: true,
      phoneSupport: true,
      dedicatedManager: true,
    } as PlanFeatures,
  },
]

function PlanCard({
  plan,
  isCurrentPlan,
  t,
}: {
  plan: (typeof defaultPlans)[0]
  isCurrentPlan: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (key: string, values?: any) => string
}) {
  const Icon = plan.icon
  const features = plan.features

  const featuresList = [
    {
      key: 'products',
      value: features.maxProducts
        ? t('includedFeatures.products', { count: features.maxProducts })
        : t('includedFeatures.productsUnlimited'),
      included: true,
    },
    {
      key: 'collaborators',
      value: features.maxCollaborators === 0
        ? t('includedFeatures.noCollaborators')
        : features.maxCollaborators
          ? t('includedFeatures.collaborators', { count: features.maxCollaborators })
          : t('includedFeatures.collaboratorsUnlimited'),
      included: features.maxCollaborators !== 0,
    },
    {
      key: 'storefront',
      value: t('includedFeatures.storefront'),
      included: true,
    },
    {
      key: 'contracts',
      value: t('includedFeatures.contracts'),
      included: true,
    },
    {
      key: 'onlinePayment',
      value: t('includedFeatures.onlinePayment'),
      included: features.onlinePayment,
    },
    {
      key: 'analytics',
      value: t('includedFeatures.analytics'),
      included: features.analytics,
    },
    {
      key: 'customDomain',
      value: t('includedFeatures.customDomain'),
      included: features.customDomain,
    },
    {
      key: 'customerPortal',
      value: t('includedFeatures.customerPortal'),
      included: features.customerPortal,
    },
    {
      key: 'reviewBooster',
      value: t('includedFeatures.reviewBooster'),
      included: features.reviewBooster,
    },
    {
      key: 'prioritySupport',
      value: t('includedFeatures.prioritySupport'),
      included: features.prioritySupport,
    },
    {
      key: 'phoneSupport',
      value: t('includedFeatures.phoneSupport'),
      included: features.phoneSupport,
    },
    {
      key: 'dedicatedManager',
      value: t('includedFeatures.dedicatedManager'),
      included: features.dedicatedManager,
    },
  ]

  return (
    <Card
      className={cn(
        'relative flex flex-col transition-all duration-300',
        plan.isPopular && 'border-primary shadow-lg scale-[1.02]',
        isCurrentPlan && 'ring-2 ring-primary'
      )}
    >
      {plan.isPopular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground shadow-sm">
            {t('popular')}
          </Badge>
        </div>
      )}

      <CardHeader className="text-center pb-2">
        <div
          className={cn(
            'mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl',
            plan.isPopular
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon className="h-6 w-6" />
        </div>
        <CardTitle className="text-xl">{t(`plans.${plan.slug}.name`)}</CardTitle>
        <CardDescription className="min-h-[40px]">{t(`plans.${plan.slug}.description`)}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col">
        {/* Early Bird Badge */}
        {plan.originalPrice && (
          <div className="text-center mb-2">
            <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              {t('earlyBird')}
            </Badge>
          </div>
        )}

        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2">
            <span className="text-4xl font-bold">{plan.price}€</span>
            {plan.originalPrice && (
              <span className="text-lg text-muted-foreground line-through">
                {plan.originalPrice}€
              </span>
            )}
          </div>
          {plan.originalPrice && (
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              -{Math.round((1 - plan.price / plan.originalPrice) * 100)}%
            </p>
          )}
          <span className="text-muted-foreground">{t('perMonth')}</span>
        </div>

        <Separator className="mb-6" />

        <ul className="space-y-3 flex-1">
          {featuresList.map((feature) => (
            <li
              key={feature.key}
              className={cn(
                'flex items-start gap-3 text-sm',
                !feature.included && 'text-muted-foreground/50'
              )}
            >
              <div
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                  feature.included
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground/50'
                )}
              >
                <Check className="h-3 w-3" />
              </div>
              <span className={cn(!feature.included && 'line-through')}>
                {feature.value}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6">
          {isCurrentPlan ? (
            <Button variant="outline" className="w-full" disabled>
              {t('current')}
            </Button>
          ) : (
            <Button
              variant={plan.isPopular ? 'default' : 'outline'}
              className="w-full"
            >
              {t('selectPlan')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default async function SubscriptionPage() {
  const store = await getCurrentStore()
  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.settings.subscriptionSettings')

  // Use default plans for now (since we don't have database plans yet)
  const currentPlanSlug: string = 'start' // Default to start plan

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      {/* Current Plan Summary */}
      <Card className="bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {t('currentPlan')}
          </CardTitle>
          <CardDescription>
            {t(`plans.${currentPlanSlug}.description`)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold">
                {t(`plans.${currentPlanSlug}.name`)}
              </p>
              <p className="text-muted-foreground">
                {defaultPlans.find((p) => p.slug === currentPlanSlug)?.price}€{t('perMonth')}
              </p>
            </div>
            {currentPlanSlug !== 'ultra' && (
              <Button>
                {t('upgrade')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Plans Grid */}
      <div>
        <h2 className="text-lg font-semibold mb-4">{t('features')}</h2>
        <div className="grid gap-6 md:grid-cols-3">
          {defaultPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrentPlan={plan.slug === currentPlanSlug}
              t={t}
            />
          ))}
        </div>
      </div>

      {/* Help Section */}
      <Card className="bg-muted/30">
        <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 py-6">
          <div>
            <h3 className="font-semibold">{t('needHelp')}</h3>
            <p className="text-sm text-muted-foreground">{t('helpText')}</p>
          </div>
          <Button variant="outline">{t('contactSales')}</Button>
        </CardContent>
      </Card>
    </div>
  )
}
