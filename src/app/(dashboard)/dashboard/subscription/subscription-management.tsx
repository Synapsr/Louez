'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Crown,
  Check,
  X,
  Sparkles,
  FileText,
  ExternalLink,
  Calendar,
  Zap,
  Package,
  CalendarDays,
  Users,
  Gift,
  Clock,
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
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  createCheckoutSession,
  openCustomerPortal,
  cancelSubscription,
  reactivateSubscription,
} from './actions'
import type { Plan, Currency } from '@/lib/plans'
import {
  isPlanAvailable,
  getYearlyPrice,
  CURRENCY_SYMBOLS,
  SUPPORTED_CURRENCIES,
} from '@/lib/plans'

interface Subscription {
  id: string
  planSlug: string
  status: 'active' | 'cancelled' | 'past_due' | 'trialing'
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean | null
  stripeSubscriptionId?: string | null
  stripeCustomerId?: string | null
  plan: Plan | undefined
  billingInterval: 'monthly' | 'yearly' | null
  billingCurrency: Currency | null
}

interface SubscriptionManagementProps {
  subscription: Subscription | null
  plans: Plan[]
  canAccessBillingPortal: boolean
  showSuccess?: boolean
  showCanceled?: boolean
}

// Helper function to format price with currency
function formatPrice(amount: number, currency: Currency): string {
  const symbol = CURRENCY_SYMBOLS[currency]
  if (currency === 'eur') {
    return `${amount}${symbol}`
  }
  return `${symbol}${amount}`
}

// Early bird discount: current prices are 50% off until March 1st, 2026
// Original prices are 2x the current prices
const EARLY_BIRD_END_DATE = new Date('2026-03-01')

function getOriginalPrice(discountedPrice: number): number {
  return discountedPrice * 2
}

function isEarlyBirdActive(): boolean {
  return new Date() < EARLY_BIRD_END_DATE
}

export function SubscriptionManagement({
  subscription,
  plans,
  canAccessBillingPortal,
  showSuccess,
  showCanceled,
}: SubscriptionManagementProps) {
  const locale = useLocale()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isYearly, setIsYearly] = useState(false)
  // Default currency based on locale: EUR for French, USD for all others
  const [currency, setCurrency] = useState<Currency>(locale === 'fr' ? 'eur' : 'usd')
  const [showCancelModal, setShowCancelModal] = useState(false)
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
        currency,
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

  const handleCancelClick = () => {
    setShowCancelModal(true)
  }

  const handleCancelConfirm = async () => {
    setLoading('cancel')
    setError(null)
    try {
      await cancelSubscription()
      setShowCancelModal(false)
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
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">{t('status.active')}</Badge>
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
    return currentPlanSlug === plan.slug
  }

  const canChangePlan = (plan: Plan) => {
    if (plan.price === 0) return false
    // Allow changing billing interval even on the same plan
    return isPlanAvailable(plan, isYearly ? 'yearly' : 'monthly', currency)
  }

  // Get key limits to display prominently
  const getKeyLimits = (plan: Plan): string[] => {
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

    return list
  }

  // Get included extras (features that are true for this plan)
  const getIncludedExtras = (plan: Plan): string[] => {
    const features = plan.features
    const list: string[] = []
    if (features.onlinePayment) list.push(t('plans.features.onlinePayment'))
    if (features.analytics) list.push(t('plans.features.analytics'))
    if (features.customerPortal) list.push(t('plans.features.customerPortal'))
    if (features.reviewBooster) list.push(t('plans.features.reviewBooster'))
    if (features.whiteLabel) list.push(t('plans.features.whiteLabel'))
    if (features.customDomain) list.push(t('plans.features.customDomain'))
    if (features.prioritySupport) list.push(t('plans.features.prioritySupport'))
    return list
  }

  // Get not included features (features that are false for this plan)
  const getNotIncludedFeatures = (plan: Plan): string[] => {
    const features = plan.features
    const list: string[] = []
    if (!features.onlinePayment) list.push(t('plans.features.onlinePayment'))
    if (!features.analytics) list.push(t('plans.features.analytics'))
    if (!features.customerPortal) list.push(t('plans.features.customerPortal'))
    if (!features.reviewBooster) list.push(t('plans.features.reviewBooster'))
    if (!features.whiteLabel) list.push(t('plans.features.whiteLabel'))
    if (!features.customDomain) list.push(t('plans.features.customDomain'))
    if (!features.prioritySupport) list.push(t('plans.features.prioritySupport'))
    return list
  }

  // Get the current plan info
  const currentPlanSlug = subscription?.planSlug || 'start'
  const currentPlan = subscription?.plan || plans.find(p => p.slug === currentPlanSlug) || plans[0]
  const hasPaidSubscription = subscription?.stripeSubscriptionId && currentPlan?.price !== 0
  const isActive = subscription?.status === 'active'

  return (
    <div className="space-y-8">
      {/* Alerts */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erreur</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {showSuccess && (
        <Alert className="border-green-500/50 bg-green-500/10">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-600">{t('alerts.successTitle')}</AlertTitle>
          <AlertDescription>{t('alerts.successDescription')}</AlertDescription>
        </Alert>
      )}

      {showCanceled && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('alerts.canceledTitle')}</AlertTitle>
          <AlertDescription>{t('alerts.canceledDescription')}</AlertDescription>
        </Alert>
      )}

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

      {/* Current Plan Overview */}
      <Card className="overflow-hidden pt-0">
        <div className={cn(
          'h-2',
          currentPlanSlug === 'ultra' && 'bg-gradient-to-r from-amber-400 to-orange-500',
          currentPlanSlug === 'pro' && 'bg-gradient-to-r from-primary to-blue-600',
          currentPlanSlug === 'start' && 'bg-muted'
        )} />
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn(
                'p-2 rounded-lg',
                currentPlanSlug === 'ultra' && 'bg-amber-500/10',
                currentPlanSlug === 'pro' && 'bg-primary/10',
                currentPlanSlug === 'start' && 'bg-muted'
              )}>
                {currentPlanSlug === 'ultra' ? (
                  <Crown className="h-6 w-6 text-amber-500" />
                ) : currentPlanSlug === 'pro' ? (
                  <Sparkles className="h-6 w-6 text-primary" />
                ) : (
                  <Zap className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div>
                <CardTitle className="text-2xl">{currentPlan?.name || 'Start'}</CardTitle>
                <CardDescription>{currentPlan?.description}</CardDescription>
              </div>
            </div>
            {hasPaidSubscription && getStatusBadge(subscription?.status || 'active')}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Pricing info - use actual billing currency and interval */}
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold">
              {formatPrice(
                currentPlan?.price
                  ? subscription?.billingInterval === 'yearly'
                    ? getYearlyPrice(currentPlan)
                    : currentPlan.price
                  : 0,
                subscription?.billingCurrency || currency
              )}
            </span>
            {currentPlan?.price !== 0 && (
              <span className="text-muted-foreground">
                / {subscription?.billingInterval === 'yearly' ? t('year') : t('month')}
              </span>
            )}
            {currentPlan?.price === 0 && (
              <span className="text-muted-foreground ml-2">{t('freePlan')}</span>
            )}
          </div>

          {/* Billing period */}
          {hasPaidSubscription && subscription?.currentPeriodEnd && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>
                {t('currentPlan.nextBilling', {
                  date: format(subscription.currentPeriodEnd, 'dd MMMM yyyy', {
                    locale: fr,
                  }),
                })}
              </span>
            </div>
          )}

          <Separator />

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            {canAccessBillingPortal && (
              <Button
                variant="outline"
                onClick={handleOpenPortal}
                disabled={loading === 'portal'}
              >
                <FileText className="mr-2 h-4 w-4" />
                {t('billingPortal.openPortal')}
                <ExternalLink className="ml-2 h-3 w-3" />
              </Button>
            )}

            {hasPaidSubscription && !subscription?.cancelAtPeriodEnd && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleCancelClick}
                disabled={loading === 'cancel'}
              >
                {t('cancelSubscription')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Plans Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Crown className="h-5 w-5" />
              {hasPaidSubscription ? t('changePlan') : t('noSubscription.title')}
            </h2>
            <p className="text-muted-foreground text-sm mt-1">
              {hasPaidSubscription
                ? t('changePlanDescription')
                : t('noSubscription.description')}
            </p>
          </div>

          {/* Billing Toggle and Currency Selector */}
          <div className="flex items-center gap-4">
            {/* Currency Selector */}
            <div className="flex items-center bg-muted/50 rounded-full p-1">
              {SUPPORTED_CURRENCIES.map((curr) => (
                <button
                  key={curr}
                  onClick={() => setCurrency(curr)}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium rounded-full transition-colors',
                    currency === curr
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {curr.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Billing Toggle */}
            <div className="flex items-center gap-3 bg-muted/50 rounded-full px-4 py-2">
              <Label
                htmlFor="billing-toggle"
                className={cn('text-sm cursor-pointer', !isYearly && 'font-semibold')}
              >
                {t('monthly')}
              </Label>
              <Switch id="billing-toggle" checked={isYearly} onCheckedChange={setIsYearly} />
              <Label
                htmlFor="billing-toggle"
                className={cn('text-sm cursor-pointer flex items-center gap-2', isYearly && 'font-semibold')}
              >
                {t('yearly')}
                <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600 border-0">
                  -17%
                </Badge>
              </Label>
            </div>
          </div>
        </div>

        {/* Early Bird Banner */}
        {isEarlyBirdActive() && (
          <div className="max-w-4xl mx-auto relative overflow-hidden rounded-xl bg-primary/5 border border-primary/20 p-6">
            <div className="absolute top-0 right-0 w-40 h-40 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg flex-shrink-0">
                  <Gift className="h-7 w-7 text-primary-foreground" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-xl">{t('earlyBird.title')}</h3>
                    <Badge className="bg-primary text-primary-foreground border-0 shadow-sm text-sm px-3">
                      {t('earlyBird.badge')}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{t('earlyBird.description')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary bg-primary/10 rounded-full px-4 py-2">
                <Clock className="h-4 w-4" />
                <span>{t('earlyBird.subtitle')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Plan Cards */}
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const price = getPrice(plan)
            const originalPrice = getOriginalPrice(price)
            const isFree = plan.price === 0
            const showEarlyBird = isEarlyBirdActive() && !isFree
            const isAvailable = canChangePlan(plan)
            const isCurrent = isCurrentPlan(plan)

            // Check if user is on this exact plan + billing interval
            const currentBillingInterval = subscription?.billingInterval
            const selectedInterval = isYearly ? 'yearly' : 'monthly'
            const isExactCurrentPlan = isCurrent && currentBillingInterval === selectedInterval

            // Determine button label
            const getButtonLabel = () => {
              if (loading === plan.slug) return t('processing')
              if (isFree) return t('freePlan')
              if (!isAvailable) return t('notAvailable')
              if (isExactCurrentPlan) return t('currentPlanBadge')
              if (isCurrent) {
                // Current plan but different billing cycle
                return isYearly ? t('switchToYearly') : t('switchToMonthly')
              }
              return t('selectPlan')
            }

            return (
              <Card
                key={plan.slug}
                className={cn(
                  'relative flex flex-col transition-all duration-200',
                  plan.isPopular && !isCurrent && 'border-primary shadow-lg scale-[1.02]',
                  isCurrent && 'ring-2 ring-primary bg-primary/5'
                )}
              >
                {plan.isPopular && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="flex items-center gap-1 px-3 py-1 shadow-md">
                      <Sparkles className="h-3 w-3" />
                      {t('popular')}
                    </Badge>
                  </div>
                )}

                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="secondary" className="flex items-center gap-1 px-3 py-1">
                      <Check className="h-3 w-3" />
                      {t('currentPlanBadge')}
                    </Badge>
                  </div>
                )}

                <CardHeader className="text-center pb-2 pt-6">
                  {/* Plan icon */}
                  <div className={cn(
                    "mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full",
                    plan.slug === 'start' && "bg-muted",
                    plan.slug === 'pro' && "bg-primary/10",
                    plan.slug === 'ultra' && "bg-gradient-to-br from-amber-400/20 to-orange-500/20"
                  )}>
                    {plan.slug === 'start' && <Zap className="h-6 w-6 text-muted-foreground" />}
                    {plan.slug === 'pro' && <Sparkles className="h-6 w-6 text-primary" />}
                    {plan.slug === 'ultra' && <Crown className="h-6 w-6 text-amber-500" />}
                  </div>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription className="min-h-[40px]">
                    {plan.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex-1">
                  <div className="text-center mb-6">
                    {/* Early bird pricing with original price crossed out */}
                    {showEarlyBird && (
                      <div className="mb-1">
                        <span className="text-lg text-muted-foreground line-through">
                          {formatPrice(originalPrice, currency)}
                        </span>
                      </div>
                    )}
                    <span className="text-4xl font-bold">{formatPrice(price, currency)}</span>
                    {!isFree && (
                      <span className="text-muted-foreground ml-1">
                        /{isYearly ? t('year') : t('month')}
                      </span>
                    )}
                    {/* Price guaranteed for life badge */}
                    {showEarlyBird && (
                      <div className="mt-2">
                        <Badge variant="outline" className="text-xs bg-green-500/5 text-green-600 border-green-500/20">
                          {t('earlyBird.guaranteedForLife')}
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* All included features */}
                  <ul className="space-y-2.5">
                    {/* Key limits */}
                    {getKeyLimits(plan).map((feature, index) => (
                      <li key={`limit-${index}`} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                    {/* Included extras */}
                    {getIncludedExtras(plan).map((feature, index) => (
                      <li key={`extra-${index}`} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Separator and not included features (only show if there are some) */}
                  {getNotIncludedFeatures(plan).length > 0 && (
                    <>
                      <Separator className="my-4" />
                      <ul className="space-y-2.5">
                        {getNotIncludedFeatures(plan).map((feature, index) => (
                          <li key={`not-${index}`} className="flex items-start gap-2">
                            <X className="h-4 w-4 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
                            <span className="text-sm text-muted-foreground/60">{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </CardContent>

                <CardFooter className="pt-4">
                  <Button
                    className="w-full"
                    variant={isCurrent ? 'outline' : plan.isPopular ? 'default' : 'outline'}
                    size="lg"
                    onClick={() => handleSubscribe(plan.slug)}
                    disabled={loading !== null || isFree || !isAvailable || isExactCurrentPlan}
                  >
                    {getButtonLabel()}
                  </Button>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Cancel Subscription Modal */}
      <Dialog open={showCancelModal} onOpenChange={setShowCancelModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <DialogTitle className="text-center text-xl">
              {t('cancelModal.title')}
            </DialogTitle>
            <DialogDescription className="text-center">
              {t('cancelModal.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            <div className="flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <Package className="h-5 w-5 text-destructive/70" />
              <span className="text-sm">{t('cancelModal.limit1')}</span>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <CalendarDays className="h-5 w-5 text-destructive/70" />
              <span className="text-sm">{t('cancelModal.limit2')}</span>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <Users className="h-5 w-5 text-destructive/70" />
              <span className="text-sm">{t('cancelModal.limit3')}</span>
            </div>
          </div>

          {subscription?.currentPeriodEnd && (
            <div className="rounded-lg bg-muted p-3 text-center text-sm text-muted-foreground">
              {t('cancelModal.keepAccess', {
                date: format(subscription.currentPeriodEnd, 'dd MMMM yyyy', {
                  locale: fr,
                }),
              })}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="destructive"
              onClick={handleCancelConfirm}
              disabled={loading === 'cancel'}
              className="w-full"
            >
              {loading === 'cancel' ? t('processing') : t('cancelModal.confirm')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowCancelModal(false)}
              disabled={loading === 'cancel'}
              className="w-full"
            >
              {t('cancelModal.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
