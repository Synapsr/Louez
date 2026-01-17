import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { getCachedPlaceDetails } from '@/lib/google-places/cache'
import { GoogleReviewsWidget } from './google-reviews-widget'

interface GoogleReviewsSectionProps {
  placeId: string
  primaryColor?: string
}

async function GoogleReviewsContent({
  placeId,
  primaryColor,
}: GoogleReviewsSectionProps) {
  const t = await getTranslations('storefront.reviews')
  const details = await getCachedPlaceDetails(placeId)

  if (!details || !details.reviews || details.reviews.length === 0) {
    return null
  }

  return (
    <section className="py-12 md:py-16">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8 md:mb-10">
          <h2 className="text-2xl md:text-3xl font-bold">{t('title')}</h2>
          <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
        </div>
        <GoogleReviewsWidget
          placeName={details.name}
          rating={details.rating || 0}
          reviewCount={details.reviewCount || 0}
          reviews={details.reviews}
          mapsUrl={details.mapsUrl}
          primaryColor={primaryColor}
        />
      </div>
    </section>
  )
}

function GoogleReviewsSkeleton() {
  return (
    <section className="py-12 md:py-16">
      <div className="container mx-auto px-4">
        <div className="text-center mb-8 md:mb-10">
          <div className="h-8 w-48 bg-muted/50 rounded-lg mx-auto animate-pulse" />
          <div className="h-4 w-64 bg-muted/30 rounded mx-auto mt-3 animate-pulse" />
        </div>
        <div className="flex justify-center gap-2 mb-6">
          <div className="h-6 w-32 bg-muted/50 rounded animate-pulse" />
          <div className="h-6 w-24 bg-muted/30 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 bg-muted/30 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    </section>
  )
}

export function GoogleReviewsSection(props: GoogleReviewsSectionProps) {
  return (
    <Suspense fallback={<GoogleReviewsSkeleton />}>
      <GoogleReviewsContent {...props} />
    </Suspense>
  )
}
