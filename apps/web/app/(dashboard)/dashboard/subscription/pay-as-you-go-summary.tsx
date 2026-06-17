'use client'

import { useState, useTransition } from 'react'

import Link from 'next/link'

import {
  AlertCircle,
  CalendarClock,
  CreditCard,
  Gauge,
  Gift,
  Loader2,
  Package,
  Receipt,
  Zap,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'

import { PayAsYouGoPricing } from './pay-as-you-go-pricing'

import { openBillingPortal } from './actions'

interface BandSummary {
  from: number
  to: number | null
  priceCents: number
}

interface InvoiceSummary {
  billingMonth: string
  locationCount: number
  grossAmountCents: number
  collectedAtSourceCents: number
  invoicedAmountCents: number
  currency: string
  status: 'open' | 'paid' | 'failed' | 'void'
  paidAt: Date | string | null
}

interface PayAsYouGoSummaryProps {
  billingMonth: string
  locationCount: number
  grossCents: number
  collectedAtSourceCents: number
  dueCents: number
  currency: string
  flatRateCents: number | null
  bands: BandSummary[]
  hasPaymentMethod: boolean
  invoices: InvoiceSummary[]
  freeReservationsRemaining: number
  freeReservationsGranted: number
}

const INVOICE_BADGE_VARIANT: Record<
  InvoiceSummary['status'],
  'success' | 'warning' | 'destructive' | 'outline'
> = {
  paid: 'success',
  open: 'warning',
  failed: 'destructive',
  void: 'outline',
}

const INVOICE_STATUS_KEY: Record<InvoiceSummary['status'], string> = {
  paid: 'statusPaid',
  open: 'statusOpen',
  failed: 'statusFailed',
  void: 'statusVoid',
}

export function PayAsYouGoSummary({
  billingMonth,
  locationCount,
  grossCents,
  collectedAtSourceCents,
  dueCents,
  currency,
  flatRateCents,
  bands,
  hasPaymentMethod,
  invoices,
  freeReservationsRemaining,
  freeReservationsGranted,
}: PayAsYouGoSummaryProps) {
  const t = useTranslations('dashboard.settings.subscription.payAsYouGo')
  const locale = useLocale()
  const [isPending, startTransition] = useTransition()
  const [portalError, setPortalError] = useState(false)

  const money = (cents: number, code = currency) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code.toUpperCase(),
    }).format(cents / 100)

  // Month boundaries are anchored at 00:00 UTC, so format in UTC to avoid showing
  // the previous day/month to viewers in negative-offset timezones.
  const monthLabel = (yyyymm: string) =>
    new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${yyyymm}-01T00:00:00Z`))

  const dateLabel = (value: Date | string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(value))

  // First day of the month following the current billing month (the charge date).
  const [year, month] = billingMonth.split('-').map(Number)
  const nextBillingDate = dateLabel(new Date(Date.UTC(year, month, 1)))

  const handleManageBilling = () => {
    setPortalError(false)
    startTransition(async () => {
      try {
        const result = await openBillingPortal()
        if (result.url) {
          window.location.href = result.url
        } else {
          setPortalError(true)
        }
      } catch {
        setPortalError(true)
      }
    })
  }

  return (
    <div className="space-y-6">
      {!hasPaymentMethod && (
        <Alert variant="warning" className="max-w-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t('noPaymentMethodTitle')}</AlertTitle>
          <AlertDescription>
            <p>{t('noPaymentMethodDescription')}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 self-start"
              onClick={handleManageBilling}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="mr-2 h-4 w-4" />
              )}
              {t('addPaymentMethod')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {portalError && (
        <Alert variant="error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t('portalError')}</AlertDescription>
        </Alert>
      )}

      {/* Welcome allowance: free reservations remaining (commission waived). */}
      {freeReservationsRemaining > 0 && (
        <Alert variant="success" className="max-w-2xl">
          <Gift className="h-4 w-4" />
          <AlertTitle>
            {t('freeReservationsTitle', { count: freeReservationsRemaining })}
          </AlertTitle>
          <AlertDescription>
            {t('freeReservationsDescription', {
              remaining: freeReservationsRemaining,
              granted: freeReservationsGranted,
            })}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Gauge className="h-5 w-5" />
                {t('title')}
              </CardTitle>
              <CardDescription>{t('description')}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="gap-1">
                <Zap className="h-3.5 w-3.5" />
                {t('badge')}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                render={<Link href="/dashboard/subscription?plans=1" />}
              >
                <Package className="mr-2 h-4 w-4" />
                {t('switchToPlan')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleManageBilling}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="mr-2 h-4 w-4" />
                )}
                {t('managePayment')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {locationCount === 0 && (
            <p className="text-muted-foreground mb-4 text-sm">
              {t('emptyState')}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <CalendarClock className="h-4 w-4" />
                {t('locationsThisMonth')}
              </div>
              <p className="mt-1 text-2xl font-bold">{locationCount}</p>
              <p className="text-muted-foreground mt-1 text-xs capitalize">
                {monthLabel(billingMonth)}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Receipt className="h-4 w-4" />
                {t('estimatedInvoice')}
              </div>
              <p className="mt-1 text-2xl font-bold">{money(dueCents)}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('dueOn', { date: nextBillingDate })}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Zap className="h-4 w-4" />
                {t('collectedAtSource')}
              </div>
              <p className="mt-1 text-2xl font-bold">
                {money(collectedAtSourceCents)}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('collectedAtSourceHint')}
              </p>
            </div>
          </div>

          <p className="text-muted-foreground mt-4 text-sm">
            {t('billingNote', { gross: money(grossCents) })}
          </p>
        </CardContent>
      </Card>

      {/* Pricing and invoice history side by side: the tariff ladder is narrow, so
          giving it its own column keeps the rates easy to read. Stacks on mobile. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <PayAsYouGoPricing
          flatRateCents={flatRateCents}
          bands={bands}
          currency={currency}
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5" />
              {t('invoiceHistoryTitle')}
            </CardTitle>
            <CardDescription>{t('invoiceHistoryDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('noInvoicesYet')}</p>
          ) : (
            <ul className="divide-y">
              {invoices.map((invoice) => (
                <li
                  key={invoice.billingMonth}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium capitalize">
                      {monthLabel(invoice.billingMonth)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t('invoiceLocations', { count: invoice.locationCount })}
                      {invoice.paidAt
                        ? ` · ${t('paidOn', { date: dateLabel(invoice.paidAt) })}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium">
                      {money(invoice.invoicedAmountCents, invoice.currency)}
                    </span>
                    <Badge variant={INVOICE_BADGE_VARIANT[invoice.status]}>
                      {t(INVOICE_STATUS_KEY[invoice.status])}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
