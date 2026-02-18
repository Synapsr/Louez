import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { db } from '@louez/db'
import { stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'

import { CheckoutForm } from './checkout-form'
import { BackButton } from './back-button'
import { generateStoreMetadata } from '@/lib/seo'
import { PageTracker } from '@/components/storefront/page-tracker'
import { getTulipSettings } from '@/lib/integrations/tulip/settings'
import type { StoreSettings, StoreTheme } from '@louez/types'

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

  const pricingMode = 'day' as const
  const reservationMode = store.settings?.reservationMode || 'payment'
  const taxSettings = store.settings?.tax
  const depositPercentage = store.settings?.onlinePaymentDepositPercentage ?? 100
  const deliverySettings = store.settings?.delivery
  const storeAddress = store.address
  const storeLatitude = store.latitude ? parseFloat(store.latitude) : null
  const storeLongitude = store.longitude ? parseFloat(store.longitude) : null
  const tulipSettings = getTulipSettings((store.settings as StoreSettings | null) || null)
  const tulipConnected = Boolean(
    tulipSettings.enabled &&
      tulipSettings.apiKeyEncrypted &&
      tulipSettings.renterUid,
  )
  const tulipMode = tulipConnected ? tulipSettings.publicMode : 'no_public'
  const effectiveRequireCustomerAddress = !(
    tulipConnected &&
    tulipMode !== 'no_public' &&
    tulipSettings.contractType === 'LCD'
  )

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
          requireCustomerAddress={effectiveRequireCustomerAddress}
          cgv={store.cgv}
          taxSettings={taxSettings}
          depositPercentage={depositPercentage}
          deliverySettings={deliverySettings}
          storeAddress={storeAddress}
          storeLatitude={storeLatitude}
          storeLongitude={storeLongitude}
          tulipInsurance={{
            enabled: tulipConnected && tulipMode !== 'no_public',
            mode: tulipMode,
            includeInFinalPrice: tulipSettings.includeInFinalPrice,
            contractType: tulipSettings.contractType,
          }}
        />
      </div>
    </>
  )
}
