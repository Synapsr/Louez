import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { CheckCircle2, Clock, Calendar, ArrowRight, CreditCard, Shield } from 'lucide-react'

import { db } from '@/lib/db'
import { reservations, stores } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate } from '@/lib/utils'

interface SuccessPageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ reservation?: string }>
}

export default async function CheckoutSuccessPage({
  params,
  searchParams,
}: SuccessPageProps) {
  const { slug } = await params
  const { reservation: reservationId } = await searchParams

  if (!reservationId) {
    redirect(`/${slug}`)
  }

  const t = await getTranslations('storefront.checkout')

  // Get store
  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  // Get reservation with customer
  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
    with: {
      customer: true,
      items: true,
    },
  })

  if (!reservation) {
    redirect(`/${slug}`)
  }

  const currency = store.settings?.currency || 'EUR'
  const isPending = reservation.status === 'pending'
  const isConfirmed = reservation.status === 'confirmed'

  return (
    <div className="container mx-auto max-w-2xl px-4 py-12">
      <Card>
        <CardHeader className="text-center pb-2">
          {isConfirmed ? (
            <CheckCircle2 className="mx-auto h-16 w-16 text-green-500" />
          ) : (
            <Clock className="mx-auto h-16 w-16 text-yellow-500" />
          )}
          <CardTitle className="mt-4 text-2xl">
            {isConfirmed ? t('success.confirmedTitle') : t('success.pendingTitle')}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          <p className="text-center text-muted-foreground">
            {isConfirmed
              ? t('success.confirmedDescription')
              : t('success.pendingDescription')}
          </p>

          {/* Reservation details */}
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                {t('success.reservationNumber')}
              </span>
              <span className="font-mono font-medium">{reservation.number}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('success.dates')}</span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {formatDate(reservation.startDate)} - {formatDate(reservation.endDate)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t('success.total')}</span>
              <span className="font-medium">
                {formatCurrency(Number(reservation.totalAmount), currency)}
              </span>
            </div>
            {Number(reservation.depositAmount) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('success.deposit')}</span>
                <span>
                  {formatCurrency(Number(reservation.depositAmount), currency)}
                </span>
              </div>
            )}
          </div>

          {/* Deposit authorization info */}
          {Number(reservation.depositAmount) > 0 && reservation.depositStatus === 'card_saved' && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-4 space-y-2">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <Shield className="h-4 w-4" />
                <span className="font-medium text-sm">{t('success.depositSaved')}</span>
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                {t('success.depositSavedDescription', { amount: formatCurrency(Number(reservation.depositAmount), currency) })}
              </p>
            </div>
          )}

          {/* Items */}
          <div className="space-y-2">
            <h3 className="font-medium text-sm">{t('success.items')}</h3>
            <div className="rounded-lg border divide-y">
              {reservation.items.map((item) => (
                <div key={item.id} className="p-3 flex justify-between text-sm">
                  <span>
                    {item.productSnapshot?.name || 'Product'} x{item.quantity}
                  </span>
                  <span className="text-muted-foreground">
                    {formatCurrency(Number(item.totalPrice), currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Email confirmation notice */}
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-center">
            <p className="text-muted-foreground">
              {t('success.emailSent', { email: reservation.customer.email })}
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pt-2">
            <Button asChild>
              <Link href={`/${slug}`}>
                {t('success.backToStore')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
