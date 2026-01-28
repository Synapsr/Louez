import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'

import { CheckoutForm } from './checkout-form'
import { BackButton } from './back-button'
import { generateStoreMetadata } from '@/lib/seo'
import { PageTracker } from '@/components/storefront/page-tracker'
import type { StoreSettings, StoreTheme } from '@/types/store'

interface CheckoutPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: CheckoutPageProps): Promise<Metadata> {
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
      title: `Finaliser la réservation - ${store.name}`,
      description: `Finalisez votre réservation chez ${store.name}.`,
      noIndex: true,
    }
  )
}

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { slug } = await params
  const t = await getTranslations('storefront.checkout')

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store) {
    notFound()
  }

  const pricingMode = store.settings?.pricingMode || 'day'
  const reservationMode = store.settings?.reservationMode || 'payment'
  const requireCustomerAddress = store.settings?.requireCustomerAddress ?? false
  const taxSettings = store.settings?.tax
  const depositPercentage = store.settings?.onlinePaymentDepositPercentage ?? 100

  return (
    <>
      <PageTracker page="checkout" />
      <div className="container mx-auto px-4 py-6 md:py-8">
        {/* Back button */}
        <BackButton />

        {/* Title */}
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-1">
            {reservationMode === 'payment' ? t('paymentMode') : t('requestMode')}
          </p>
        </div>

        <CheckoutForm
          storeSlug={slug}
          storeId={store.id}
          pricingMode={pricingMode}
          reservationMode={reservationMode}
          requireCustomerAddress={requireCustomerAddress}
          cgv={store.cgv}
          taxSettings={taxSettings}
          depositPercentage={depositPercentage}
        />
      </div>
    </>
  )
}
