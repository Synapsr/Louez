import { Suspense } from 'react';

import { getTranslations } from 'next-intl/server';

import { StarIcon } from '@louez/ui/icons';

import { getCachedPlaceDetails } from '@/lib/google-places/cache';

import { GoogleReviewsWidget } from './google-reviews-widget';

interface GoogleReviewsSectionProps {
  placeId: string;
  primaryColor?: string;
}

const GoogleLogo = ({ size = 20 }: { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 48 48"
    width={size}
    height={size}
    aria-hidden="true"
  >
    <path
      fill="#FFC107"
      d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
    />
    <path
      fill="#FF3D00"
      d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
    />
    <path
      fill="#4CAF50"
      d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
    />
    <path
      fill="#1976D2"
      d="M43.611,20.083H42V20H24v8h11.303c-.792,2.237-2.231,4.166-4.087,5.571l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
    />
  </svg>
);

async function GoogleReviewsContent({ placeId }: GoogleReviewsSectionProps) {
  const t = await getTranslations('storefront.reviews');
  let details = null;
  try {
    details = await getCachedPlaceDetails(placeId);
  } catch (error) {
    console.error('Error loading storefront Google reviews:', error);
    return null;
  }

  if (!details || !details.reviews || details.reviews.length === 0) {
    return null;
  }

  const recommendedReviews = details.reviews.filter(
    (review) => review.rating >= 4,
  );

  if (recommendedReviews.length === 0) {
    return null;
  }

  return (
    <section id="reviews" className="px-6 py-20 md:px-16">
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="text-primary text-xs font-semibold tracking-[0.2em] uppercase">
              {t('label')}
            </p>
            <h2 className="text-foreground text-4xl font-bold tracking-tight md:text-5xl">
              {t('title')}
            </h2>
            <p className="text-muted-foreground mt-4 max-w-xl text-base md:text-xl">
              {t('subtitle')}
            </p>
          </div>

          <a
            href={details.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border bg-background hover:bg-accent mt-1 flex w-full items-center justify-between gap-4 rounded-full border px-5 py-3 transition-colors sm:w-fit"
          >
            <div className="flex items-center gap-2.5">
              <GoogleLogo size={20} />
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">
                  {(details.rating || 0).toFixed(1)}
                </span>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <StarIcon
                      key={star}
                      fill={'currentColor'}
                      className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
                    />
                  ))}
                </div>
                <span className="text-muted-foreground text-xs">
                  ({details.reviewCount || recommendedReviews.length})
                </span>
              </div>
            </div>
          </a>
        </div>
        <GoogleReviewsWidget reviews={recommendedReviews} />
      </div>
    </section>
  );
}

function GoogleReviewsSkeleton() {
  return (
    <section className="px-6 py-20 md:px-16">
      <div className="mx-auto w-full max-w-6xl space-y-10">
        <div className="space-y-2">
          <div className="bg-muted/50 h-3 w-24 animate-pulse rounded" />
          <div className="bg-muted/50 h-9 w-56 animate-pulse rounded-lg" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-muted/30 h-56 animate-pulse rounded-xl"
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export function GoogleReviewsSection(props: GoogleReviewsSectionProps) {
  return (
    <Suspense fallback={<GoogleReviewsSkeleton />}>
      <GoogleReviewsContent {...props} />
    </Suspense>
  );
}
