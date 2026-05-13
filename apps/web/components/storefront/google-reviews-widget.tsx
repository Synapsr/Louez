'use client';

import { useRef } from 'react';

import Image from 'next/image';

import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import type { GoogleReview } from '@louez/types';
import { Button } from '@louez/ui';
import { cn, formatRelativeTime } from '@louez/utils';

interface GoogleReviewsWidgetProps {
  reviews: GoogleReview[];
}

export function GoogleReviewsWidget({ reviews }: GoogleReviewsWidgetProps) {
  const t = useTranslations('storefront.reviews');
  const locale = useLocale();
  const carouselRef = useRef<HTMLDivElement>(null);

  const scrollReviews = (direction: 'previous' | 'next') => {
    const carousel = carouselRef.current;

    if (!carousel) {
      return;
    }

    carousel.scrollBy({
      left: direction === 'next' ? carousel.clientWidth : -carousel.clientWidth,
      behavior: 'smooth',
    });
  };

  if (reviews.length === 0) {
    return null;
  }

  return (
    <div className="relative pt-2">
      {reviews.length > 3 && (
        <div className="pointer-events-none absolute top-1/2 right-0 left-0 z-10 hidden -translate-y-1/2 justify-between md:flex">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="bg-background/90 pointer-events-auto h-11 w-11 -translate-x-1/2 rounded-full shadow-sm"
            onClick={() => scrollReviews('previous')}
            aria-label="Previous reviews"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="bg-background/90 pointer-events-auto h-11 w-11 translate-x-1/2 rounded-full shadow-sm"
            onClick={() => scrollReviews('next')}
            aria-label="Next reviews"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div
        ref={carouselRef}
        className="flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {reviews.map((review) => (
          <article
            key={`${review.authorName}-${review.time}`}
            className="border-border bg-muted/50 flex min-h-[360px] w-[calc(100vw-3rem)] shrink-0 snap-start flex-col gap-6 rounded-xl border p-8 sm:w-[420px] md:w-[calc((100%_-_3rem)/3)]"
          >
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  fill={star <= review.rating ? 'currentColor' : 'none'}
                  className={cn(
                    'h-5 w-5',
                    star <= review.rating
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-muted-foreground',
                  )}
                />
              ))}
            </div>
            <p className="text-muted-foreground text-lg leading-relaxed">
              &ldquo;{review.text || t('noReviewText')}&rdquo;
            </p>

            <div className="mt-auto flex items-center gap-4">
              {review.authorPhotoBase64 ? (
                <Image
                  src={review.authorPhotoBase64}
                  alt={review.authorName}
                  width={36}
                  height={36}
                  unoptimized
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
              ) : review.authorPhotoUrl ? (
                <Image
                  src={review.authorPhotoUrl}
                  alt={review.authorName}
                  width={36}
                  height={36}
                  unoptimized
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="bg-primary text-primary-foreground flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold">
                  {review.authorName.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-base font-semibold">{review.authorName}</p>
                <p className="text-muted-foreground text-sm">
                  {formatRelativeTime(new Date(review.time * 1000), locale)}
                </p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
