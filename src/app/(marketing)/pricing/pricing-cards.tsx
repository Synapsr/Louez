'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Check, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency } from '@/lib/utils'
import { createCheckoutSession } from './actions'
import type { PlanFeatures } from '@/types'

interface Plan {
  id: string
  name: string
  slug: string
  description: string | null
  price: string
  interval: 'monthly' | 'yearly'
  features: PlanFeatures
  isPopular: boolean | null
  stripeProductId: string | null
  stripePriceIdMonthly: string | null
  stripePriceIdYearly: string | null
}

interface PricingCardsProps {
  plans: Plan[]
  isLoggedIn: boolean
}

export function PricingCards({ plans, isLoggedIn }: PricingCardsProps) {
  const [isYearly, setIsYearly] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const router = useRouter()
  const t = useTranslations('pricing')

  const handleSubscribe = async (planSlug: string) => {
    if (!isLoggedIn) {
      router.push(`/login?redirect=/pricing&plan=${planSlug}`)
      return
    }

    setLoading(planSlug)
    try {
      const result = await createCheckoutSession({
        planSlug,
        interval: isYearly ? 'yearly' : 'monthly',
      })

      if (result.url) {
        window.location.href = result.url
      } else if ('redirectTo' in result && result.redirectTo) {
        // Handle authentication redirect
        router.push(result.redirectTo)
      } else if ('error' in result) {
        console.error('Checkout error:', result.error)
      }
    } catch (error) {
      console.error('Checkout error:', error)
    } finally {
      setLoading(null)
    }
  }

  const getPrice = (plan: Plan) => {
    const monthlyPrice = parseFloat(plan.price)
    if (monthlyPrice === 0) return 0
    if (isYearly) {
      // 2 months free on yearly
      return monthlyPrice * 10
    }
    return monthlyPrice
  }

  const getFeaturesList = (plan: Plan): string[] => {
    const features = plan.features
    const list: string[] = []

    // Products
    if (features.maxProducts === null) {
      list.push(t('features.unlimitedProducts'))
    } else {
      list.push(t('features.maxProducts', { count: features.maxProducts }))
    }

    // Reservations
    if (features.maxReservationsPerMonth === null) {
      list.push(t('features.unlimitedReservations'))
    } else {
      list.push(t('features.maxReservations', { count: features.maxReservationsPerMonth }))
    }

    // Customers
    if (features.maxCustomers === null) {
      list.push(t('features.unlimitedCustomers'))
    } else {
      list.push(t('features.maxCustomers', { count: features.maxCustomers }))
    }

    // Collaborators
    if (features.maxCollaborators !== null && features.maxCollaborators > 0) {
      list.push(t('features.collaborators', { count: features.maxCollaborators }))
    }

    // Boolean features
    if (features.onlinePayment) list.push(t('features.onlinePayment'))
    if (features.analytics) list.push(t('features.analytics'))
    if (features.emailNotifications) list.push(t('features.emailNotifications'))
    if (features.whiteLabel) list.push(t('features.whiteLabel'))
    if (features.customDomain) list.push(t('features.customDomain'))
    if (features.prioritySupport) list.push(t('features.prioritySupport'))
    if (features.customerPortal) list.push(t('features.customerPortal'))
    if (features.reviewBooster) list.push(t('features.reviewBooster'))

    return list
  }

  const isPlanAvailable = (plan: Plan) => {
    if (parseFloat(plan.price) === 0) return true // Free plan always available
    return isYearly ? !!plan.stripePriceIdYearly : !!plan.stripePriceIdMonthly
  }

  return (
    <div>
      {/* Billing Toggle */}
      <div className="flex items-center justify-center gap-4 mb-12">
        <Label
          htmlFor="billing-toggle"
          className={cn('text-sm', !isYearly && 'font-semibold')}
        >
          {t('monthly')}
        </Label>
        <Switch
          id="billing-toggle"
          checked={isYearly}
          onCheckedChange={setIsYearly}
        />
        <Label
          htmlFor="billing-toggle"
          className={cn('text-sm flex items-center gap-2', isYearly && 'font-semibold')}
        >
          {t('yearly')}
          <Badge variant="secondary" className="text-xs">
            {t('saveBadge')}
          </Badge>
        </Label>
      </div>

      {/* Pricing Cards */}
      <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
        {plans.map((plan) => {
          const price = getPrice(plan)
          const isFree = parseFloat(plan.price) === 0
          const isAvailable = isPlanAvailable(plan)

          return (
            <Card
              key={plan.id}
              className={cn(
                'relative flex flex-col',
                plan.isPopular && 'border-primary shadow-lg scale-105'
              )}
            >
              {plan.isPopular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="flex items-center gap-1 px-3 py-1">
                    <Sparkles className="h-3 w-3" />
                    {t('popular')}
                  </Badge>
                </div>
              )}

              <CardHeader className="text-center pb-2">
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <CardDescription className="min-h-[40px]">
                  {plan.description}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex-1">
                <div className="text-center mb-6">
                  <span className="text-4xl font-bold">
                    {formatCurrency(price)}
                  </span>
                  {!isFree && (
                    <span className="text-muted-foreground ml-1">
                      /{isYearly ? t('year') : t('month')}
                    </span>
                  )}
                  {isFree && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('foreverFree')}
                    </p>
                  )}
                  {!isFree && isYearly && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('billedYearly', { amount: formatCurrency(price) })}
                    </p>
                  )}
                </div>

                <ul className="space-y-3">
                  {getFeaturesList(plan).map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Check className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter className="pt-4">
                <Button
                  className="w-full"
                  variant={plan.isPopular ? 'default' : 'outline'}
                  size="lg"
                  onClick={() => handleSubscribe(plan.slug)}
                  disabled={loading !== null || !isAvailable}
                >
                  {loading === plan.slug
                    ? t('processing')
                    : isFree
                    ? t('currentPlan')
                    : isAvailable
                    ? t('subscribe')
                    : t('comingSoon')}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>

      {/* Additional info */}
      <div className="text-center mt-12 text-sm text-muted-foreground">
        <p>{t('guarantee')}</p>
      </div>
    </div>
  )
}
