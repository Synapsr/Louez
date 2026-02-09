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
import { getDepositAuthorizationData } from './actions'
import { DepositForm } from './deposit-form'
import { getLocaleFromCountry, type EmailLocale } from '@/lib/email/i18n'
import type { StoreSettings, StoreTheme } from '@louez/types'

interface AuthorizeDepositPageProps {
  params: Promise<{ slug: string; reservationId: string }>
  searchParams: Promise<{ token?: string }>
}

export async function generateMetadata({
  params,
}: AuthorizeDepositPageProps): Promise<Metadata> {
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
      title: `Deposit Authorization - ${store.name}`,
      description: `Authorize your deposit for your reservation at ${store.name}.`,
      noIndex: true,
    }
  )
}

export default async function AuthorizeDepositPage({
  params,
  searchParams,
}: AuthorizeDepositPageProps) {
  const { slug, reservationId } = await params
  const { token } = await searchParams
  const t = await getTranslations('storefront.authorizeDeposit')

  // Get data with access validation
  const data = await getDepositAuthorizationData({
    slug,
    reservationId,
    token,
  })

  if (data.error) {
    if (data.error === 'store_not_found' || data.error === 'reservation_not_found') {
      notFound()
    }

    // Get store for branding even on error
    const store = await db.query.stores.findFirst({
      where: eq(stores.slug, slug),
    })

    // Map error codes to translation keys
    const errorKeyMap: Record<string, string> = {
      invalid_token: 'invalidToken',
      stripe_not_configured: 'stripeNotConfigured',
      deposit_already_authorized: 'alreadyAuthorized',
      no_deposit_required: 'noDepositRequired',
    }

    const errorKey = errorKeyMap[data.error] || 'generic'

    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto">
          {/* Store branding */}
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

          <Alert variant="destructive">
            <AlertDescription>
              {t(`errors.${errorKey}`)}
            </AlertDescription>
          </Alert>

          <div className="mt-6 text-center">
            <Button variant="outline" render={<Link href={`/${slug}`} />}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('backToStore')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Type narrowing - at this point, we know data has store, reservation, customer, currency
  const { store, reservation, customer, currency } = data as {
    store: NonNullable<typeof data.store>
    reservation: NonNullable<typeof data.reservation>
    customer: NonNullable<typeof data.customer>
    currency: string
  }
  const storeTheme = store.theme as StoreTheme | null
  const locale = getLocaleFromCountry(store.country) as EmailLocale

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

        {/* Deposit form */}
        <DepositForm
          store={{
            id: store.id,
            name: store.name,
            slug: store.slug,
            stripeAccountId: store.stripeAccountId!,
            theme: storeTheme ? { primaryColor: storeTheme.primaryColor } : null,
          }}
          reservation={{
            id: reservation.id,
            number: reservation.number,
            depositAmount: reservation.depositAmount,
          }}
          customer={{
            firstName: customer.firstName,
            email: customer.email,
          }}
          currency={currency}
          locale={locale}
        />

        {/* Back link */}
        <div className="mt-6 text-center">
          <Button variant="ghost" size="sm" render={<Link href={`/${slug}`} />}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('backToStore')}
          </Button>
        </div>
      </div>
    </div>
  )
}
