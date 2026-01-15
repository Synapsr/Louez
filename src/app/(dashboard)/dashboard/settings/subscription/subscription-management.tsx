'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  CreditCard,
  Download,
  AlertCircle,
  CheckCircle,
  Crown,
  ArrowUpRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import {
  openCustomerPortal,
  cancelSubscription,
  reactivateSubscription,
} from './actions'
import type { PlanFeatures } from '@/types'
import Link from 'next/link'

interface Plan {
  id: string
  name: string
  slug: string
  price: string
  features: PlanFeatures
  isPopular: boolean | null
}

interface Subscription {
  id: string
  status: 'active' | 'cancelled' | 'past_due' | 'trialing'
  currentPeriodStart: Date
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean | null
  plan: Plan
}

interface Payment {
  id: string
  amount: string
  status: 'pending' | 'completed' | 'failed' | 'refunded'
  paidAt: Date | null
  periodStart: Date | null
  periodEnd: Date | null
  invoicePdfUrl: string | null
}

interface SubscriptionManagementProps {
  subscription: Subscription | null
  payments: Payment[]
  plans: Plan[]
  showSuccess?: boolean
  showCanceled?: boolean
}

export function SubscriptionManagement({
  subscription,
  payments,
  plans,
  showSuccess,
  showCanceled,
}: SubscriptionManagementProps) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const t = useTranslations('dashboard.settings.subscription')

  useEffect(() => {
    // Clear the success/canceled params from URL
    if (showSuccess || showCanceled) {
      const timeout = setTimeout(() => {
        router.replace('/dashboard/settings/subscription')
      }, 5000)
      return () => clearTimeout(timeout)
    }
  }, [showSuccess, showCanceled, router])

  const handleOpenPortal = async () => {
    setLoading(true)
    try {
      const result = await openCustomerPortal()
      if (result.url) {
        window.location.href = result.url
      }
    } catch (error) {
      console.error('Error opening portal:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!confirm(t('cancelConfirm'))) return

    setLoading(true)
    try {
      await cancelSubscription()
      router.refresh()
    } catch (error) {
      console.error('Error cancelling:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleReactivate = async () => {
    setLoading(true)
    try {
      await reactivateSubscription()
      router.refresh()
    } catch (error) {
      console.error('Error reactivating:', error)
    } finally {
      setLoading(false)
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

  const getPaymentStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default">{t('paymentStatus.completed')}</Badge>
      case 'failed':
        return <Badge variant="destructive">{t('paymentStatus.failed')}</Badge>
      case 'refunded':
        return <Badge variant="secondary">{t('paymentStatus.refunded')}</Badge>
      default:
        return <Badge variant="outline">{t('paymentStatus.pending')}</Badge>
    }
  }

  return (
    <div className="space-y-6">
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
      {subscription?.cancelAtPeriodEnd && (
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
              disabled={loading}
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
              disabled={loading}
            >
              {t('updatePayment')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* No Subscription */}
      {!subscription && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5" />
              {t('noSubscription.title')}
            </CardTitle>
            <CardDescription>{t('noSubscription.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/pricing">
                {t('noSubscription.viewPlans')}
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Current Plan */}
      {subscription && (
        <Card>
          <CardHeader>
            <CardTitle>{t('currentPlan.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{subscription.plan.name}</p>
                <p className="text-muted-foreground">
                  {formatCurrency(parseFloat(subscription.plan.price))} / {t('month')}
                </p>
              </div>
              {getStatusBadge(subscription.status)}
            </div>

            <p className="text-sm text-muted-foreground">
              {t('currentPlan.nextBilling', {
                date: format(subscription.currentPeriodEnd, 'dd MMMM yyyy', {
                  locale: fr,
                }),
              })}
            </p>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={handleOpenPortal} disabled={loading}>
                <CreditCard className="mr-2 h-4 w-4" />
                {t('manageBilling')}
              </Button>
              <Button asChild variant="outline">
                <Link href="/pricing">
                  {t('changePlan')}
                  <ArrowUpRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              {!subscription.cancelAtPeriodEnd && (
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={handleCancel}
                  disabled={loading}
                >
                  {t('cancelSubscription')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment History */}
      {subscription && (
        <Card>
          <CardHeader>
            <CardTitle>{t('paymentHistory.title')}</CardTitle>
            <CardDescription>{t('paymentHistory.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                {t('paymentHistory.empty')}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('paymentHistory.date')}</TableHead>
                    <TableHead>{t('paymentHistory.period')}</TableHead>
                    <TableHead>{t('paymentHistory.amount')}</TableHead>
                    <TableHead>{t('paymentHistory.status')}</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>
                        {payment.paidAt
                          ? format(payment.paidAt, 'dd/MM/yyyy', { locale: fr })
                          : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {payment.periodStart
                          ? format(payment.periodStart, 'MMM yyyy', { locale: fr })
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(parseFloat(payment.amount))}
                      </TableCell>
                      <TableCell>{getPaymentStatusBadge(payment.status)}</TableCell>
                      <TableCell>
                        {payment.invoicePdfUrl && (
                          <Button variant="ghost" size="icon" asChild>
                            <a
                              href={payment.invoicePdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={t('paymentHistory.downloadInvoice')}
                            >
                              <Download className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
