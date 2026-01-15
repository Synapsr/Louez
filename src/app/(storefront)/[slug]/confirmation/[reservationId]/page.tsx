import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { stores, reservations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CheckCircle, Calendar, Mail, Clock, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatCurrency } from '@/lib/utils'
import type { StoreSettings, StoreTheme } from '@/types/store'
import { generateStoreMetadata } from '@/lib/seo'

interface ConfirmationPageProps {
  params: Promise<{ slug: string; reservationId: string }>
}

export async function generateMetadata({
  params,
}: ConfirmationPageProps): Promise<Metadata> {
  const { slug } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { title: 'Boutique introuvable' }
  }

  return generateStoreMetadata(
    {
      id: store.id,
      name: store.name,
      slug: store.slug,
      settings: store.settings as StoreSettings,
      theme: store.theme as StoreTheme,
    },
    {
      title: `Confirmation de réservation - ${store.name}`,
      description: `Votre réservation a été confirmée chez ${store.name}.`,
      noIndex: true,
    }
  )
}

export default async function ConfirmationPage({ params }: ConfirmationPageProps) {
  const { slug, reservationId } = await params
  const t = await getTranslations('storefront.confirmation')

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  const storeSettings = (store.settings as StoreSettings) || {}
  const currency = storeSettings.currency || 'EUR'

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
    notFound()
  }

  const isRequest = store.settings?.reservationMode === 'request'

  // Format dates with times
  const startDateTime = format(reservation.startDate, "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })
  const endDateTime = format(reservation.endDate, "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr })

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto text-center">
        {/* Success Icon */}
        <div className="mb-6">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30">
            <CheckCircle className="h-10 w-10 text-green-600 dark:text-green-400" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl md:text-3xl font-bold mb-2">
          {isRequest ? t('titleRequest') : t('title')}
        </h1>
        <p className="text-muted-foreground mb-8">
          {isRequest ? t('subtitleRequest') : t('subtitle')}
        </p>

        {/* Reservation Summary */}
        <Card className="text-left mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-lg">
              <span>{t('reservationNumber', { number: reservation.number })}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Rental Period with times */}
            <div className="rounded-lg bg-muted/50 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground">{t('pickup')}</p>
                  <p className="font-medium capitalize">{startDateTime}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="h-5 w-5 text-primary mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-muted-foreground">{t('return')}</p>
                  <p className="font-medium capitalize">{endDateTime}</p>
                </div>
              </div>
            </div>

            {/* Customer email */}
            <div className="flex items-center gap-3 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t('confirmationSentTo')}</span>
              <span className="font-medium">{reservation.customer.email}</span>
            </div>

            <Separator />

            {/* Items */}
            <div className="space-y-2">
              {reservation.items.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span>
                    {item.productSnapshot.name} × {item.quantity}
                  </span>
                  <span>{formatCurrency(parseFloat(item.totalPrice), currency)}</span>
                </div>
              ))}
            </div>

            <Separator />

            {/* Totals */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t('subtotalLabel')}</span>
                <span>{formatCurrency(parseFloat(reservation.subtotalAmount), currency)}</span>
              </div>
              {parseFloat(reservation.depositAmount) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('depositLabel')}</span>
                  <span>{formatCurrency(parseFloat(reservation.depositAmount), currency)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-lg pt-2">
                <span>{t('totalLabel')}</span>
                <span className="text-primary">{formatCurrency(parseFloat(reservation.totalAmount), currency)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Next Steps */}
        <Card className="text-left mb-8">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{t('whatNext')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isRequest ? (
              <ol className="space-y-4">
                <li className="flex gap-3 items-start">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium animate-pulse">
                    1
                  </span>
                  <span className="text-sm pt-1">{t('stepRequest1')}</span>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm">
                    2
                  </span>
                  <span className="text-sm text-muted-foreground pt-1">{t('stepRequest2')}</span>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm">
                    3
                  </span>
                  <span className="text-sm text-muted-foreground pt-1">{t('stepRequest3')}</span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-4">
                <li className="flex gap-3 items-start">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-medium animate-pulse">
                    1
                  </span>
                  <span className="text-sm pt-1">{t('stepPayment1')}</span>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm">
                    2
                  </span>
                  <span className="text-sm text-muted-foreground pt-1">{t('stepPayment2')}</span>
                </li>
                <li className="flex gap-3 items-start">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-sm">
                    3
                  </span>
                  <span className="text-sm text-muted-foreground pt-1">{t('stepPayment3')}</span>
                </li>
              </ol>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild>
            <Link href="/account">
              <User className="mr-2 h-4 w-4" />
              {t('viewMyReservations')}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">{t('backToStore')}</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
