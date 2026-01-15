'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  CreditCard,
  AlertCircle,
  CheckCircle,
  Crown,
  Check,
  Sparkles,
  FileText,
  ExternalLink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { formatCurrency, cn } from '@/lib/utils'
import {
  createCheckoutSession,
  openCustomerPortal,
  cancelSubscription,
  reactivateSubscription,
} from './actions'
import type { Plan } from '@/lib/plans'
import { isPlanAvailable, getYearlyPrice } from '@/lib/plans'

interface Subscription {
  id: string
  planSlug: string
  status: 'active' | 'cancelled' | 'past_due' | 'trialing'
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean | null
  plan: Plan | undefined
}

interface SubscriptionManagementProps {
  subscription: Subscription | null
  plans: Plan[]
  canAccessBillingPortal: boolean
  showSuccess?: boolean
  showCanceled?: boolean
}

export function SubscriptionManagement({
  subscription,
  plans,
  canAccessBillingPortal,
  showSuccess,
  showCanceled,
}: SubscriptionManagementProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isYearly, setIsYearly] = useState(false)
  const router = useRouter()
  const t = useTranslations('dashboard.settings.subscription')

  useEffect(() => {
    if (showSuccess || showCanceled) {
      const timeout = setTimeout(() => {
        router.replace('/dashboard/subscription')
      }, 5000)
      return () => clearTimeout(timeout)
    }
  }, [showSuccess, showCanceled, router])

  const handleSubscribe = async (planSlug: string) => {
    setLoading(planSlug)
    setError(null)
    try {
      const result = await createCheckoutSession({
        planSlug,
        interval: isYearly ? 'yearly' : 'monthly',
      })

      if (result.url) {
        window.location.href = result.url
      } else if ('error' in result) {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    } finally {
      setLoading(null)
    }
  }

  const handleOpenPortal = async () => {
    setLoading('portal')
    setError(null)
    try {
      const result = await openCustomerPortal()
      if (result.url) {
        window.location.href = result.url
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    } finally {
      setLoading(null)
    }
  }

  const handleCancel = async () => {
    if (!confirm(t('cancelConfirm'))) return

    setLoading('cancel')
    setError(null)
    try {
      await cancelSubscription()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    } finally {
      setLoading(null)
    }
  }

  const handleReactivate = async () => {
    setLoading('reactivate')
    setError(null)
    try {
      await reactivateSubscription()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue')
    } finally {
      setLoading(null)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="default">{t('status.active')}</Badge>
      case 'trialing':
        return <Badge variant="secondary">{t('status.trialing')}</Badge>
      case 'past_due':
        return <Badge variant="destructive">{t('status.pastDue')}</Badge>
      case 'cancelled':
        return <Badge variant="outline">{t('status.cancelled')}</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const getPrice = (plan: Plan) => {
    if (plan.price === 0) return 0
    if (isYearly) {
      return getYearlyPrice(plan)
    }
    return plan.price
  }

  const isCurrentPlan = (plan: Plan) => {
    return subscription?.planSlug === plan.slug
  }

  const canUpgrade = (plan: Plan) => {
    if (plan.price === 0) return false
    return isPlanAvailable(plan, isYearly ? 'yearly' : 'monthly')
  }

  const getFeaturesList = (plan: Plan): string[] => {
    const features = plan.features
    const list: string[] = []

    if (features.maxProducts === null) {
      list.push(t('plans.features.unlimitedProducts'))
    } else {
      list.push(t('plans.features.maxProducts', { count: features.maxProducts }))
    }

    if (features.maxReservationsPerMonth === null) {
      list.push(t('plans.features.unlimitedReservations'))
    } else {
      list.push(
        t('plans.features.maxReservations', { count: features.maxReservationsPerMonth })
      )
    }

    if (features.maxCustomers === null) {
      list.push(t('plans.features.unlimitedCustomers'))
    } else {
      list.push(t('plans.features.maxCustomers', { count: features.maxCustomers }))
    }

    if (features.maxCollaborators !== null && features.maxCollaborators > 0) {
      list.push(t('plans.features.collaborators', { count: features.maxCollaborators }))
    }

    if (features.onlinePayment) list.push(t('plans.features.onlinePayment'))
    if (features.analytics) list.push(t('plans.features.analytics'))
    if (features.customerPortal) list.push(t('plans.features.customerPortal'))
    if (features.whiteLabel) list.push(t('plans.features.whiteLabel'))
    if (features.customDomain) list.push(t('plans.features.customDomain'))
    if (features.prioritySupport) list.push(t('plans.features.prioritySupport'))
    if (features.reviewBooster) list.push(t('plans.features.reviewBooster'))

    return list
  }

  const hasActiveSubscription =
    subscription?.status === 'active' && subscription?.plan?.price !== 0

  return (
    <div className="space-y-6">
      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erreur</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Success Alert */}
      {showSuccess && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>{t('alerts.successTitle')}</AlertTitle>
          <AlertDescription>{t('alerts.successDescription')}</AlertDescription>
        </Alert>
      )}

      {/* Canceled Alert */}
      {showCanceled && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('alerts.canceledTitle')}</AlertTitle>
          <AlertDescription>{t('alerts.canceledDescription')}</AlertDescription>
        </Alert>
      )}

      {/* Cancellation Warning */}
      {subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t('alerts.cancellingAt', {
              date: format(subscription.currentPeriodEnd, 'dd MMMM yyyy', {
                locale: fr,
              }),
            })}
            <Button
              variant="link"
              className="p-0 h-auto ml-2"
              onClick={handleReactivate}
              disabled={loading !== null}
            >
              {t('reactivate')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Past Due Warning */}
      {subscription?.status === 'past_due' && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t('alerts.pastDue')}
            <Button
              variant="link"
              className="p-0 h-auto ml-2"
              onClick={handleOpenPortal}
              disabled={loading !== null}
            >
              {t('updatePayment')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Current Plan Card - Show when user has an active paid subscription */}
      {hasActiveSubscription && subscription.plan && (
        <Card>
          <CardHeader>
            <CardTitle>{t('currentPlan.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{subscription.plan.name}</p>
                <p className="text-muted-foreground">
                  {formatCurrency(subscription.plan.price)} / {t('month')}
                </p>
              </div>
              {getStatusBadge(subscription.status)}
            </div>

            {subscription.currentPeriodEnd && (
              <p className="text-sm text-muted-foreground">
                {t('currentPlan.nextBilling', {
                  date: format(subscription.currentPeriodEnd, 'dd MMMM yyyy', {
                    locale: fr,
                  }),
                })}
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={handleOpenPortal} disabled={loading !== null}>
                <CreditCard className="mr-2 h-4 w-4" />
                {t('manageBilling')}
              </Button>
              {!subscription.cancelAtPeriodEnd && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={handleCancel}
                  disabled={loading !== null}
                >
                  {t('cancelSubscription')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Billing Portal Card - Show when user has Stripe customer but no active subscription */}
      {canAccessBillingPortal && !hasActiveSubscription && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t('billingPortal.title')}
            </CardTitle>
            <CardDescription>{t('billingPortal.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={handleOpenPortal}
              disabled={loading !== null}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t('billingPortal.openPortal')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Plans Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5" />
            {hasActiveSubscription ? t('changePlan') : t('noSubscription.title')}
          </CardTitle>
          <CardDescription>
            {hasActiveSubscription
              ? t('changePlanDescription')
              : t('noSubscription.description')}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Billing Toggle */}
      <div className="flex items-center justify-center gap-4">
        <Label
          htmlFor="billing-toggle"
          className={cn('text-sm', !isYearly && 'font-semibold')}
        >
          {t('monthly')}
        </Label>
        <Switch id="billing-toggle" checked={isYearly} onCheckedChange={setIsYearly} />
        <Label
          htmlFor="billing-toggle"
          className={cn('text-sm flex items-center gap-2', isYearly && 'font-semibold')}
        >
          {t('yearly')}
          <Badge variant="secondary" className="text-xs">
            {t('yearlyDiscount')}
          </Badge>
        </Label>
      </div>

      {/* Plan Cards */}
      <div className="grid md:grid-cols-3 gap-6">
        {plans.map((plan) => {
          const price = getPrice(plan)
          const isFree = plan.price === 0
          const isAvailable = canUpgrade(plan)
          const isCurrent = isCurrentPlan(plan)

          return (
            <Card
              key={plan.slug}
              className={cn(
                'relative flex flex-col',
                plan.isPopular && 'border-primary shadow-lg',
                isCurrent && 'ring-2 ring-primary'
              )}
            >
              {plan.isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
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
                  <span className="text-4xl font-bold">{formatCurrency(price)}</span>
                  {!isFree && (
                    <span className="text-muted-foreground ml-1">
                      /{isYearly ? t('year') : t('month')}
                    </span>
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
                  disabled={loading !== null || !isAvailable || isFree || isCurrent}
                >
                  {loading === plan.slug
                    ? t('processing')
                    : isCurrent
                      ? t('currentPlanBadge')
                      : isFree
                        ? t('freePlan')
                        : isAvailable
                          ? t('selectPlan')
                          : t('notAvailable')}
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
