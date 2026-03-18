import type { Metadata } from 'next'
import { db } from '@louez/db'
import { stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Button } from '@louez/ui'
import { Alert, AlertDescription } from '@louez/ui'
import { generateStoreMetadata } from '@/lib/seo'
import { getStorefrontUrl } from '@/lib/storefront-url'
import { getPaymentRequestData } from './actions'
import { PaymentRequestPage } from './payment-request-page'
import type { StoreSettings, StoreTheme } from '@louez/types'

interface PayPageProps {
  params: Promise<{ slug: string; reservationId: string }>
  searchParams: Promise<{ token?: string }>
}

export async function generateMetadata({ params }: PayPageProps): Promise<Metadata> {
  const { slug } = await params

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
      title: `Payment - ${store.name}`,
      description: `Complete your payment for your reservation at ${store.name}.`,
      noIndex: true,
    }
  )
}

export default async function PayPage({ params, searchParams }: PayPageProps) {
  const { slug, reservationId } = await params
  const { token } = await searchParams
  const t = await getTranslations('storefront.pay')

  if (!token) {
    notFound()
  }

  const data = await getPaymentRequestData({ slug, reservationId, token })

  if ('error' in data) {
    if (data.error === 'store_not_found' || data.error === 'reservation_not_found') {
      notFound()
    }

    // Get store for branding even on error
    const store = await db.query.stores.findFirst({
      where: eq(stores.slug, slug),
    })

    const errorKeyMap: Record<string, string> = {
      invalid_token: 'expired',
      already_paid: 'alreadyPaid',
      cancelled: 'cancelled',
      stripe_not_configured: 'unavailable',
    }

    const errorKey = errorKeyMap[data.error as string] || 'error'

    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto">
          {store && (
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
          )}

          <Alert variant="error">
            <AlertDescription>
              <p className="font-medium">{t(`errors.${errorKey}Title`)}</p>
              <p className="mt-1 text-sm">{t(`errors.${errorKey}Description`)}</p>
            </AlertDescription>
          </Alert>

          <div className="mt-6 text-center">
            <Button variant="outline" render={<Link href={getStorefrontUrl(slug, '/')} />}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('backToStore')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const { store, reservation, paymentRequest, customer } = data
  const storeTheme = store.theme as StoreTheme | null

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-lg mx-auto">
        <PaymentRequestPage
          store={{
            name: store.name,
            slug: store.slug,
            logoUrl: store.logoUrl,
            theme: storeTheme ? { primaryColor: storeTheme.primaryColor } : null,
          }}
          reservation={{
            number: reservation.number,
          }}
          paymentRequest={{
            id: paymentRequest.id,
            amount: paymentRequest.amount,
            currency: paymentRequest.currency,
            description: paymentRequest.description,
          }}
          customerFirstName={customer.firstName}
          token={token}
        />

        <div className="mt-6 text-center">
          <Button variant="ghost" render={<Link href={getStorefrontUrl(slug, '/')} />}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('backToStore')}
          </Button>
        </div>
      </div>
    </div>
  )
}
