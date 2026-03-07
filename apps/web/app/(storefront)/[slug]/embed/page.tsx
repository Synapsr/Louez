import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { db } from '@louez/db'
import { stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { EmbedDatePicker } from '@/components/storefront/embed-date-picker'
import { getStorefrontUrl } from '@/lib/storefront-url'
import { getMinRentalMinutes } from '@/lib/utils/rental-duration'
import type { StoreSettings } from '@louez/types'

interface EmbedPageProps {
  params: Promise<{ slug: string }>
}

export default async function EmbedPage({ params }: EmbedPageProps) {
  const { slug } = await params

  const store = await db.query.stores.findFirst({
    where: eq(stores.slug, slug),
  })

  if (!store || !store.onboardingCompleted) {
    notFound()
  }

  const settings = (store.settings as StoreSettings) || {}
  const pricingMode = 'day' as const
  const businessHours = settings.businessHours
  const timezone = settings.timezone
  const advanceNotice = settings.advanceNoticeMinutes || 0
  const minRentalMinutes = getMinRentalMinutes(settings)
  const rentalUrl = getStorefrontUrl(slug, '/rental')

  return (
    <div className="p-2">
      <Suspense fallback={<div className="h-36 bg-muted/30 rounded-2xl animate-pulse" />}>
        <EmbedDatePicker
          rentalUrl={rentalUrl}
          pricingMode={pricingMode}
          businessHours={businessHours}
          advanceNotice={advanceNotice}
          minRentalMinutes={minRentalMinutes}
          timezone={timezone}
        />
      </Suspense>
    </div>
  )
}
