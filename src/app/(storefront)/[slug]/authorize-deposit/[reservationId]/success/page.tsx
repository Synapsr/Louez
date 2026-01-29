import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { stores, reservations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { Shield, CheckCircle, ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { generateStoreMetadata } from '@/lib/seo'
import { formatCurrency } from '@/lib/utils'
import type { StoreSettings, StoreTheme } from '@/types/store'

interface SuccessPageProps {
  params: Promise<{ slug: string; reservationId: string }>
}

export async function generateMetadata({
  params,
}: SuccessPageProps): Promise<Metadata> {
  const { slug } = await params
  const t = await getTranslations('storefront.authorizeDeposit')

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    return { title: 'Store not found' }
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
      title: `${t('success.title')} - ${store.name}`,
      noIndex: true,
    }
  )
}

export default async function DepositSuccessPage({ params }: SuccessPageProps) {
  const { slug, reservationId } = await params
  const t = await getTranslations('storefront.authorizeDeposit')

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  const reservation = await db.query.reservations.findFirst({
    where: and(
      eq(reservations.id, reservationId),
      eq(reservations.storeId, store.id)
    ),
    with: {
      customer: true,
    },
  })

  if (!reservation) {
    notFound()
  }

  const storeSettings = (store.settings as StoreSettings) || {}
  const currency = storeSettings.currency || 'EUR'
  const depositAmount = parseFloat(reservation.depositAmount || '0')

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-lg mx-auto">
        {/* Store branding */}
        <div className="text-center mb-8">
          {store.logoUrl ? (
            <Image
              src={store.logoUrl}
              alt={store.name}
              width={120}
              height={40}
              className="h-10 w-auto mx-auto mb-4 object-contain"
            />
          ) : (
            <h1 className="text-2xl font-bold mb-4">{store.name}</h1>
          )}
        </div>

        {/* Success card */}
        <Card>
          <CardContent className="pt-8 pb-8 text-center">
            {/* Success icon */}
            <div className="mb-6">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-10 w-10 text-green-600 dark:text-green-400" />
              </div>
            </div>

            {/* Title */}
            <h2 className="text-2xl font-bold mb-2">{t('success.title')}</h2>
            <p className="text-muted-foreground mb-6">
              {t('success.description', { amount: formatCurrency(depositAmount, currency) })}
            </p>

            {/* Info box */}
            <div className="bg-muted/50 rounded-lg p-4 mb-6 text-sm text-left">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium mb-1">{t('success.whatHappensNext')}</p>
                  <p className="text-muted-foreground">
                    {t('success.willBeReleased')}
                  </p>
                </div>
              </div>
            </div>

            {/* Reservation info */}
            <div className="text-sm text-muted-foreground mb-6">
              {t('subtitle', { number: reservation.number })}
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild>
                <Link href={`/${slug}/account`}>
                  {t('success.viewReservations')}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/${slug}`}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('backToStore')}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
